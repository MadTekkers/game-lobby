-- Public, redacted table state (what every player may see). Written only by the 'cards' edge function (service role).
create table public.card_games (
  id text primary key,
  game text not null check (game in ('blackjack','spades','holdem')),
  public jsonb not null,
  version int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.card_games enable row level security;
create policy card_games_read on public.card_games for select to anon, authenticated using (true);
alter table public.card_games replica identity full;
alter publication supabase_realtime add table public.card_games;

-- Full authoritative state incl. shoe/deck order, hidden cards, seat token hashes. RLS on, NO policies => only service role.
create table public.card_secrets (
  id text primary key references public.card_games(id) on delete cascade,
  state jsonb not null,
  version int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.card_secrets enable row level security;
revoke all on public.card_secrets from anon, authenticated;

-- Play-money bankrolls. Public read (leaderboard); writes only via the service role.
create table public.bankrolls (
  player text primary key check (char_length(player) between 1 and 40),
  chips bigint not null default 1000,
  peak bigint not null default 1000,
  hands int not null default 0,
  rebuys int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.bankrolls enable row level security;
create policy bankrolls_read on public.bankrolls for select to anon, authenticated using (true);

-- Atomic chip adjustment, callable only by the service role.
create or replace function public.bank_adjust(p_player text, p_delta bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into bankrolls(player) values (p_player) on conflict (player) do nothing;
  update bankrolls set chips = chips + p_delta, peak = greatest(peak, chips + p_delta), updated_at = now()
    where player = p_player and chips + p_delta >= 0 returning chips into v;
  if v is null then raise exception 'insufficient chips'; end if;
  return v;
end $$;
revoke all on function public.bank_adjust(text, bigint) from public, anon, authenticated;
grant execute on function public.bank_adjust(text, bigint) to service_role;

create or replace function public.bank_get(p_player text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into bankrolls(player) values (p_player) on conflict (player) do nothing;
  -- free top-up when broke
  update bankrolls set chips = 1000, rebuys = rebuys + 1, updated_at = now() where player = p_player and chips < 10;
  select chips into v from bankrolls where player = p_player;
  return v;
end $$;
revoke all on function public.bank_get(text) from public, anon, authenticated;
grant execute on function public.bank_get(text) to service_role;

create or replace function public.bank_hand(p_player text)
returns void language sql security definer set search_path = public as $$
  update bankrolls set hands = hands + 1 where player = p_player;
$$;
revoke all on function public.bank_hand(text) from public, anon, authenticated;
grant execute on function public.bank_hand(text) to service_role;
