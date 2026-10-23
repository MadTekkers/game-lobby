-- Card games v2: Hearts, self-tuning bots (params + per-hand review log), clamped bankroll settlement.
alter table public.card_games drop constraint card_games_game_check;
alter table public.card_games add constraint card_games_game_check check (game in ('blackjack','spades','hearts','holdem'));

-- Live bot parameters per game/level. "params" = variant A (current), "candidate" = variant B under A/B test.
create table public.bot_params (
  game text not null, level text not null, params jsonb not null default '{}', candidate jsonb,
  generation int not null default 0, updated_at timestamptz not null default now(), primary key (game, level)
);
alter table public.bot_params enable row level security;
create policy bot_params_read on public.bot_params for select to anon, authenticated using (true);

-- One row per seat per finished hand (bots and humans) — the raw material for the nightly review. Service role only.
create table public.card_hands (
  id bigserial primary key, game text not null, room_id text, kind text not null, level text, variant text,
  metrics jsonb not null, created_at timestamptz not null default now()
);
create index card_hands_game_time on public.card_hands (game, created_at);
alter table public.card_hands enable row level security;
revoke all on public.card_hands from anon, authenticated;

-- What each nightly run changed and why (public, for transparency).
create table public.bot_tuning_log (
  id bigserial primary key, game text not null, level text not null, generation int not null,
  before jsonb, after jsonb, candidate jsonb, review jsonb, created_at timestamptz not null default now()
);
alter table public.bot_tuning_log enable row level security;
create policy bot_tuning_log_read on public.bot_tuning_log for select to anon, authenticated using (true);

-- Hashed shared secrets for privileged maintenance actions (e.g. the nightly tuner). Service role only.
create table public.app_secrets (name text primary key, hash text not null, created_at timestamptz not null default now());
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

-- Settlement that never fails: losses floor the bankroll at 0 (used for game/hand-end settlement).
create or replace function public.bank_adjust_clamp(p_player text, p_delta bigint)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into bankrolls(player) values (p_player) on conflict (player) do nothing;
  update bankrolls set chips = greatest(0, chips + p_delta), peak = greatest(peak, chips + p_delta), updated_at = now()
    where player = p_player returning chips into v;
  return v;
end $$;
revoke all on function public.bank_adjust_clamp(text, bigint) from public, anon, authenticated;
grant execute on function public.bank_adjust_clamp(text, bigint) to service_role;
