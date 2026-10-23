-- Spy Words (team word-guessing game). Secret keys never leave the server except to the seat allowed to see them.
-- Public state: spy_games (read-only to clients, realtime). Secrets: spy_keys + spy_seats (RLS on, no policies, no grants).
-- All mutations go through SECURITY DEFINER RPCs that authenticate a per-seat token.

create table if not exists public.spy_words (word text primary key check (word ~ '^[A-Z]{2,12}$'));
alter table public.spy_words enable row level security;
drop policy if exists spy_words_read on public.spy_words;
create policy spy_words_read on public.spy_words for select to anon, authenticated using (true);

create table if not exists public.spy_games (
  room_id text primary key,
  mode text not null check (mode in ('classic', 'duet')),
  host text not null,
  phase text not null default 'setup' check (phase in ('setup', 'clue', 'guess', 'sudden', 'over')),
  seats jsonb not null default '[]',
  words text[],
  revealed jsonb not null default '[]',
  turn text,
  start_team text,
  clue jsonb,
  guesses_left int not null default 0,
  guesses_made int not null default 0,
  log jsonb not null default '[]',
  turns int not null default 0,
  turns_left int,
  winner text,
  reason text,
  key_reveal jsonb,
  game_no int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  version int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.spy_games enable row level security;
drop policy if exists spy_games_read on public.spy_games;
create policy spy_games_read on public.spy_games for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.spy_games from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'spy_games') then
    alter publication supabase_realtime add table public.spy_games;
  end if;
end $$;

create table if not exists public.spy_seats (
  room_id text not null,
  player text not null check (char_length(player) between 1 and 40),
  token uuid not null default gen_random_uuid(),
  team text,
  spy boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, player)
);
alter table public.spy_seats enable row level security;
revoke all on public.spy_seats from anon, authenticated;

create table if not exists public.spy_keys (room_id text primary key, key text[], key_a text[], key_b text[]);
alter table public.spy_keys enable row level security;
revoke all on public.spy_keys from anon, authenticated;

alter table public.results add column if not exists detail jsonb;

-- ---------- internal helpers (not callable by clients) ----------
create or replace function public.spy__sync(p_room text) returns void language sql security definer set search_path = public as $$
  update spy_games set seats = coalesce((select jsonb_agg(jsonb_build_object('name', player, 'team', team, 'spy', spy) order by joined_at)
    from spy_seats where room_id = p_room), '[]'::jsonb), version = version + 1, updated_at = now() where room_id = p_room;
$$;

create or replace function public.spy__me(p_room text, p_token uuid) returns public.spy_seats language plpgsql security definer set search_path = public as $$
declare s spy_seats;
begin
  select * into s from spy_seats where room_id = p_room and token = p_token;
  if not found then raise exception 'not_seated'; end if;
  return s;
end $$;

create or replace function public.spy__lock(p_room text) returns public.spy_games language plpgsql security definer set search_path = public as $$
declare g spy_games;
begin
  select * into g from spy_games where room_id = p_room for update;
  if not found then raise exception 'no_game'; end if;
  return g;
end $$;

create or replace function public.spy__over(p_room text, p_winner text, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; k spy_keys;
begin
  select * into k from spy_keys where room_id = p_room;
  update spy_games set phase = 'over', winner = p_winner, reason = p_reason, finished_at = now(), clue = null,
    key_reveal = case when mode = 'classic' then to_jsonb(k.key) else jsonb_build_object('A', k.key_a, 'B', k.key_b) end,
    version = version + 1, updated_at = now()
  where room_id = p_room returning * into g;
  insert into results (room_id, player, game, puzzle_id, won, mistakes, hints, seconds, detail)
  select p_room, s.player, 'spywords', case when g.mode = 'classic' then 0 else 1 end,
    case when g.mode = 'classic' then s.team = p_winner else p_winner = 'team' end,
    (select count(*) from jsonb_array_elements(g.log) e, jsonb_array_elements(e->'guesses') x
       where case when g.mode = 'classic' then e->>'team' = s.team and x->>'color' <> s.team else x->>'color' <> 'green' end)::int,
    g.turns, greatest(0, extract(epoch from g.finished_at - g.started_at))::int,
    jsonb_build_object('mode', g.mode, 'winner', p_winner, 'reason', p_reason, 'turns', g.turns, 'team', s.team,
      'role', case when g.mode = 'duet' then 'agent' when s.spy then 'spymaster' else 'guesser' end, 'game_no', g.game_no)
  from spy_seats s where s.room_id = p_room and s.team is not null;
end $$;

-- classic: other team's turn
create or replace function public.spy__end_classic(p_room text) returns void language sql security definer set search_path = public as $$
  update spy_games set turn = case turn when 'red' then 'blue' else 'red' end, phase = 'clue', clue = null, guesses_left = 0, guesses_made = 0,
    version = version + 1, updated_at = now() where room_id = p_room;
$$;

-- duet: spend a turn, pick next clue giver (whoever still has greens on their key), or enter sudden death
create or replace function public.spy__end_duet(p_room text) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; k spy_keys; nxt text; left_other int; tl int;
begin
  select * into g from spy_games where room_id = p_room;
  select * into k from spy_keys where room_id = p_room;
  tl := g.turns_left - 1;
  if tl <= 0 then
    update spy_games set turns_left = 0, phase = 'sudden', turn = null, clue = null, guesses_left = 0, guesses_made = 0, version = version + 1, updated_at = now() where room_id = p_room;
    return;
  end if;
  nxt := case g.turn when 'A' then 'B' else 'A' end;
  select count(*) into left_other from generate_series(1, 25) i
    where (case nxt when 'A' then k.key_a[i] else k.key_b[i] end) = 'green' and not ((g.revealed->(i - 1)) ? 'g');
  if left_other = 0 then nxt := g.turn; end if;
  update spy_games set turns_left = tl, phase = 'clue', turn = nxt, clue = null, guesses_left = 0, guesses_made = 0, version = version + 1, updated_at = now() where room_id = p_room;
end $$;

-- ---------- client RPCs ----------
create or replace function public.spy_join(p_room text, p_player text, p_token uuid default null) returns uuid language plpgsql security definer set search_path = public as $$
declare r rooms; g spy_games; s spy_seats; nm text := btrim(coalesce(p_player, ''));
begin
  if char_length(nm) < 1 or char_length(nm) > 40 then raise exception 'bad_name'; end if;
  select * into g from spy_games where room_id = p_room for update;
  if not found then
    select * into r from rooms where id = p_room;
    if not found then raise exception 'no_room'; end if;
    insert into spy_games (room_id, mode, host) values (p_room, case when r.params->>'mode' = 'coop' then 'duet' else 'classic' end, coalesce(nullif(r.host, ''), nm))
      on conflict (room_id) do nothing;
    select * into g from spy_games where room_id = p_room for update;
  end if;
  select * into s from spy_seats where room_id = p_room and player = nm;
  if found then
    if s.token = p_token then return s.token; end if;
    -- same name from a new device: allowed only before the game starts, and it drops spymaster + rotates the token
    if g.phase <> 'setup' then raise exception 'name_taken'; end if;
    update spy_seats set token = gen_random_uuid(), spy = false where room_id = p_room and player = nm returning * into s;
    perform spy__sync(p_room);
    return s.token;
  end if;
  insert into spy_seats (room_id, player) values (p_room, nm) returning * into s;
  perform spy__sync(p_room);
  return s.token;
end $$;

create or replace function public.spy_seat(p_room text, p_token uuid, p_team text, p_spy boolean) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats; sp boolean := coalesce(p_spy, false);
begin
  g := spy__lock(p_room); s := spy__me(p_room, p_token);
  if g.phase <> 'setup' then raise exception 'game_started'; end if;
  if g.mode = 'classic' then
    if p_team is not null and p_team not in ('red', 'blue') then raise exception 'bad_team'; end if;
    if sp and p_team is null then raise exception 'bad_team'; end if;
    if sp and exists (select 1 from spy_seats where room_id = p_room and team = p_team and spy and player <> s.player) then raise exception 'spymaster_taken'; end if;
  else
    if p_team is not null and p_team not in ('A', 'B') then raise exception 'bad_team'; end if;
    if p_team is not null and exists (select 1 from spy_seats where room_id = p_room and team = p_team and player <> s.player) then raise exception 'seat_taken'; end if;
    sp := false;
  end if;
  update spy_seats set team = p_team, spy = sp where room_id = p_room and player = s.player;
  perform spy__sync(p_room);
end $$;

create or replace function public.spy_start(p_room text, p_token uuid) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats; w text[]; k text[]; ka text[]; kb text[]; st text; t text;
begin
  g := spy__lock(p_room); s := spy__me(p_room, p_token);
  if s.player <> g.host then raise exception 'not_host'; end if;
  if g.phase <> 'setup' then raise exception 'game_started'; end if;
  if g.mode = 'classic' then
    foreach t in array array['red', 'blue'] loop
      if (select count(*) from spy_seats where room_id = p_room and team = t and spy) <> 1 then raise exception 'need_spymaster_%', t; end if;
      if (select count(*) from spy_seats where room_id = p_room and team = t and not spy) < 1 then raise exception 'need_guesser_%', t; end if;
    end loop;
  else
    if (select count(*) from spy_seats where room_id = p_room and team in ('A', 'B')) <> 2 then raise exception 'need_two'; end if;
  end if;
  select array_agg(word) into w from (select word from spy_words order by random() limit 25) x;
  if g.mode = 'classic' then
    st := case when random() < 0.5 then 'red' else 'blue' end;
    select array_agg(c order by random()) into k from unnest(
      array_fill(st, array[9]) || array_fill(case st when 'red' then 'blue' else 'red' end, array[8]) || array_fill('neutral'::text, array[7]) || array['assassin']) c;
    insert into spy_keys (room_id, key) values (p_room, k) on conflict (room_id) do update set key = excluded.key, key_a = null, key_b = null;
    update spy_games set phase = 'clue', words = w, revealed = (select jsonb_agg(null::text) from generate_series(1, 25)), turn = st, start_team = st,
      turns_left = null, clue = null, guesses_left = 0, guesses_made = 0, log = '[]', turns = 0, winner = null, reason = null, key_reveal = null,
      game_no = game_no + 1, started_at = now(), finished_at = null, version = version + 1, updated_at = now() where room_id = p_room;
  else
    -- dual key: 3 green/green, 5+5 green/neutral, 1+1 green/assassin, 1 assassin/assassin, 1+1 assassin/neutral, 7 neutral/neutral
    with pairs as (
      select p, row_number() over (order by random()) rn from unnest(
        array_fill('green|green'::text, array[3]) || array_fill('green|neutral'::text, array[5]) || array['green|assassin'] ||
        array_fill('neutral|green'::text, array[5]) || array['assassin|green', 'assassin|assassin', 'assassin|neutral', 'neutral|assassin'] ||
        array_fill('neutral|neutral'::text, array[7])) p)
    select array_agg(split_part(p, '|', 1) order by rn), array_agg(split_part(p, '|', 2) order by rn) into ka, kb from pairs;
    insert into spy_keys (room_id, key_a, key_b) values (p_room, ka, kb) on conflict (room_id) do update set key = null, key_a = excluded.key_a, key_b = excluded.key_b;
    st := case when random() < 0.5 then 'A' else 'B' end;
    update spy_games set phase = 'clue', words = w, revealed = (select jsonb_agg('{}'::jsonb) from generate_series(1, 25)), turn = st, start_team = st,
      turns_left = 9, clue = null, guesses_left = 0, guesses_made = 0, log = '[]', turns = 0, winner = null, reason = null, key_reveal = null,
      game_no = game_no + 1, started_at = now(), finished_at = null, version = version + 1, updated_at = now() where room_id = p_room;
  end if;
  update rooms set status = 'playing' where id = p_room;
end $$;

-- Returns the key ONLY to a seat allowed to see it: classic spymasters get the full key, duet agents get their own half.
create or replace function public.spy_key(p_room text, p_token uuid) returns text[] language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats; k spy_keys;
begin
  select * into g from spy_games where room_id = p_room;
  if not found then raise exception 'no_game'; end if;
  s := spy__me(p_room, p_token);
  if g.phase = 'setup' then raise exception 'not_started'; end if;
  select * into k from spy_keys where room_id = p_room;
  if g.mode = 'classic' then
    if s.spy and s.team in ('red', 'blue') then return k.key; end if;
  else
    if s.team = 'A' then return k.key_a; end if;
    if s.team = 'B' then return k.key_b; end if;
  end if;
  raise exception 'not_allowed';
end $$;

create or replace function public.spy_clue(p_room text, p_token uuid, p_word text, p_n int) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats; wd text := upper(btrim(coalesce(p_word, ''))); bw text;
begin
  g := spy__lock(p_room); s := spy__me(p_room, p_token);
  if g.phase <> 'clue' then raise exception 'not_clue_phase'; end if;
  if g.mode = 'classic' then
    if not (s.spy and s.team = g.turn) then raise exception 'not_your_turn'; end if;
  elsif s.team is distinct from g.turn then raise exception 'not_your_turn'; end if;
  if wd !~ '^[A-Z]{1,24}$' then raise exception 'one_word'; end if;
  if p_n is null or p_n < 0 or p_n > 9 then raise exception 'bad_number'; end if;
  foreach bw in array g.words loop
    if wd = bw or wd in (bw || 'S', bw || 'ES', bw || 'ED', bw || 'ING', bw || 'ER') or bw in (wd || 'S', wd || 'ES') then raise exception 'board_word'; end if;
  end loop;
  update spy_games set phase = 'guess', clue = jsonb_build_object('word', wd, 'n', p_n, 'by', s.player, 'team', g.turn),
    guesses_left = case when g.mode = 'duet' or p_n = 0 then 99 else p_n + 1 end, guesses_made = 0, turns = turns + 1,
    log = log || jsonb_build_array(jsonb_build_object('team', g.turn, 'by', s.player, 'word', wd, 'n', p_n, 'guesses', '[]'::jsonb)),
    version = version + 1, updated_at = now() where room_id = p_room;
end $$;

create or replace function public.spy_guess(p_room text, p_token uuid, p_idx int) returns text language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats; k spy_keys; c text; rev jsonb; lg jsonb; last int; cell jsonb; giver text; red_left int; blue_left int; greens int; other text;
begin
  g := spy__lock(p_room); s := spy__me(p_room, p_token);
  if p_idx is null or p_idx < 0 or p_idx > 24 then raise exception 'bad_card'; end if;
  select * into k from spy_keys where room_id = p_room;
  last := jsonb_array_length(g.log) - 1;
  if g.mode = 'classic' then
    if g.phase <> 'guess' then raise exception 'not_guess_phase'; end if;
    if s.team is distinct from g.turn or s.spy then raise exception 'not_your_turn'; end if;
    if g.revealed->p_idx <> 'null'::jsonb then raise exception 'already_revealed'; end if;
    c := k.key[p_idx + 1];
    rev := jsonb_set(g.revealed, array[p_idx::text], to_jsonb(c));
    lg := jsonb_set(g.log, array[last::text, 'guesses'], (g.log->last->'guesses') || jsonb_build_array(jsonb_build_object('idx', p_idx, 'word', g.words[p_idx + 1], 'color', c, 'by', s.player)));
    update spy_games set revealed = rev, log = lg, guesses_made = guesses_made + 1, guesses_left = guesses_left - 1, version = version + 1, updated_at = now() where room_id = p_room;
    select count(*) filter (where k.key[i] = 'red' and rev->(i - 1) = 'null'::jsonb), count(*) filter (where k.key[i] = 'blue' and rev->(i - 1) = 'null'::jsonb)
      into red_left, blue_left from generate_series(1, 25) i;
    other := case g.turn when 'red' then 'blue' else 'red' end;
    if c = 'assassin' then perform spy__over(p_room, other, 'assassin');
    elsif red_left = 0 then perform spy__over(p_room, 'red', 'found_all');
    elsif blue_left = 0 then perform spy__over(p_room, 'blue', 'found_all');
    elsif c <> g.turn or g.guesses_left - 1 <= 0 then perform spy__end_classic(p_room);
    end if;
    return c;
  end if;
  -- duet
  if g.phase = 'guess' then
    if s.team not in ('A', 'B') or s.team = g.turn then raise exception 'not_your_turn'; end if;
    giver := g.turn;
  elsif g.phase = 'sudden' then
    if s.team not in ('A', 'B') then raise exception 'not_your_turn'; end if;
    giver := case s.team when 'A' then 'B' else 'A' end;
  else raise exception 'not_guess_phase'; end if;
  cell := g.revealed->p_idx;
  if cell ? 'g' then raise exception 'already_revealed'; end if;
  if cell ? ('n' || giver) then raise exception 'already_neutral'; end if;
  c := case giver when 'A' then k.key_a[p_idx + 1] else k.key_b[p_idx + 1] end;
  cell := cell || case c when 'green' then '{"g":true}'::jsonb when 'neutral' then jsonb_build_object('n' || giver, true) else '{"x":true}'::jsonb end;
  rev := jsonb_set(g.revealed, array[p_idx::text], cell);
  if last < 0 then -- sudden death guesses get their own log entry
    lg := g.log || jsonb_build_array(jsonb_build_object('team', 'sudden', 'by', s.player, 'word', null, 'n', 0, 'guesses', jsonb_build_array(jsonb_build_object('idx', p_idx, 'word', g.words[p_idx + 1], 'color', c, 'by', s.player))));
  elsif g.phase = 'sudden' and g.log->last->>'team' <> 'sudden' then
    lg := g.log || jsonb_build_array(jsonb_build_object('team', 'sudden', 'by', s.player, 'word', null, 'n', 0, 'guesses', jsonb_build_array(jsonb_build_object('idx', p_idx, 'word', g.words[p_idx + 1], 'color', c, 'by', s.player))));
  else
    lg := jsonb_set(g.log, array[last::text, 'guesses'], (g.log->last->'guesses') || jsonb_build_array(jsonb_build_object('idx', p_idx, 'word', g.words[p_idx + 1], 'color', c, 'by', s.player)));
  end if;
  update spy_games set revealed = rev, log = lg, guesses_made = guesses_made + 1, version = version + 1, updated_at = now() where room_id = p_room;
  select count(*) into greens from generate_series(0, 24) i where (rev->i) ? 'g';
  if c = 'assassin' then perform spy__over(p_room, 'none', 'assassin');
  elsif greens >= 15 then perform spy__over(p_room, 'team', 'found_all');
  elsif g.phase = 'sudden' then perform spy__over(p_room, 'none', 'sudden_death');
  elsif c = 'neutral' then perform spy__end_duet(p_room);
  end if;
  return c;
end $$;

create or replace function public.spy_pass(p_room text, p_token uuid) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats;
begin
  g := spy__lock(p_room); s := spy__me(p_room, p_token);
  if g.phase <> 'guess' then raise exception 'not_guess_phase'; end if;
  if g.guesses_made < 1 then raise exception 'guess_first'; end if;
  if g.mode = 'classic' then
    if s.team is distinct from g.turn or s.spy then raise exception 'not_your_turn'; end if;
    perform spy__end_classic(p_room);
  else
    if s.team not in ('A', 'B') or s.team = g.turn then raise exception 'not_your_turn'; end if;
    perform spy__end_duet(p_room);
  end if;
end $$;

-- host: back to team setup for another round (keeps seats)
create or replace function public.spy_reset(p_room text, p_token uuid) returns void language plpgsql security definer set search_path = public as $$
declare g spy_games; s spy_seats;
begin
  g := spy__lock(p_room); s := spy__me(p_room, p_token);
  if s.player <> g.host then raise exception 'not_host'; end if;
  if g.phase <> 'over' then raise exception 'not_over'; end if;
  delete from spy_keys where room_id = p_room;
  update spy_games set phase = 'setup', words = null, revealed = '[]', turn = null, clue = null, log = '[]', turns = 0, turns_left = null,
    winner = null, reason = null, key_reveal = null, guesses_left = 0, guesses_made = 0, version = version + 1, updated_at = now() where room_id = p_room;
end $$;

revoke execute on function public.spy__sync(text), public.spy__me(text, uuid), public.spy__lock(text), public.spy__over(text, text, text),
  public.spy__end_classic(text), public.spy__end_duet(text) from public, anon, authenticated;
grant execute on function public.spy_join(text, text, uuid), public.spy_seat(text, uuid, text, boolean), public.spy_start(text, uuid),
  public.spy_key(text, uuid), public.spy_clue(text, uuid, text, int), public.spy_guess(text, uuid, int), public.spy_pass(text, uuid),
  public.spy_reset(text, uuid) to anon, authenticated;
