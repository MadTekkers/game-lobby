# Game Lobby

Live: https://game-lobby-games.vercel.app

NYT-Games-style daily word games built with Vite + React + TypeScript, with real-time multiplayer on Supabase.

Games: **Wordle**, **Connections** (easy / medium / hard), **Mini Strands**, **Crossword** (5/10/30 min ≈ 7×7/11×11/15×15, easy/medium/hard), **The Mini** (5×5). *(Archived — hidden but intact: **Crossword** (big), **Spelling Bee**.)*

- **Modes**: Solo, Competitive (same puzzle, private boards, live leaderboard of all players), Co-op (one shared board, colored live cursors/drag paths). Connections co-op has per-tile locks and a compare-and-swap submit lock.
- **Lobbies**: create a lobby (game, mode, difficulty, length, name, optional private 4-letter code); it appears live in "Open lobbies" for everyone on the site; host presses Start. Share links still work (good for group chats). Site-wide presence shows who's online, ★ marks people you've played with, and "Rejoin" lists your recent rooms.
- **Caps**: 8 players for shared boards, 24 for competitive (soft-enforced in the UI).
- **History & leaderboard** with completion times; daily streaks; confetti, sounds (toggle), animations.

### Puzzle sources (all bundled, no runtime APIs)
- Crossword clues: Princeton **WordNet 3.x** glosses/synonyms/examples (WordNet license, permissive) via `wordnet-db`; difficulty tiers by **wordfreq** Zipf frequency (Apache-2.0 / CC-BY-SA data). `scripts/crossword/build_clues.py` → `gen_crosswords.py` (180°-symmetric block pattern + backtracking fill, most-constrained-slot first). Easy = common words + definition/example clues; Hard = rarer words + terse synonym clues.
- Spelling Bee: `an-array-of-english-words` (MIT) filtered by wordfreq; `scripts/gen_bee.py`.
- Wordle: curated answers + `an-array-of-english-words` guesses.
- Connections: original curated banks (easy everyday, medium trivia/pop culture), hand-written hard puzzles with wordplay and red herrings.
- All puzzles are validated by `npm test` (grid/answer consistency, symmetry, tiling, uniqueness).

```
npm i && npm test && npm run build
```
Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key).

### Crossword repository
Big crosswords (7×7, 11×11, 15×15) live in the Supabase table `crosswords` (id, size, difficulty, grid, across, down, created_at, published), so new ones appear without a redeploy. The Crossword setup screen browses the whole repository (filter by size, difficulty, played/unplayed, newest/oldest). The Mini (5×5) stays bundled with the weekly games.

```
npm run crossword:generate -- --count 30            # rotates through sizes × difficulties
npm run crossword:generate -- --count 10 --sizes 15 --difficulties hard
```
Needs `python3` only (stdlib + bundled `scripts/crossword/clues.json`). Every puzzle is validated before insert and deduplicated by grid fingerprint. Credentials come from env or `/workspace/.secrets/game-lobby.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CROSSWORD_INGEST_SECRET`); inserts go through the `insert_crossword` RPC, which checks a SHA-256-hashed ingest key, so no service-role key is needed and nothing secret ships to the client.

## Weekly puzzles

`npm run weekly` generates a full week (Mon–Sun, America/Chicago) of **new** puzzles for Wordle, Connections (easy/medium/hard), Mini Strands, Spelling Bee and The Mini (difficulty by day: Mon–Tue easy, Wed–Fri medium, Sat–Sun hard) — 49 puzzles per week.
Each puzzle is validated, de-duplicated against every previous week by fingerprint, and saved to Supabase `weekly_puzzles` via the `insert_weekly` RPC (needs `CROSSWORD_INGEST_SECRET`), so **no redeploy is needed**. Snapshots are committed to `puzzles/weekly/<week>.json`.

```
npm run weekly                      # ensure current + next week (idempotent)
npm run weekly -- --backfill 8      # plus the 8 previous weeks
npm run weekly -- --week 2026-10-12 # one week
npm run weekly -- --dry-run         # generate + validate only
```

Crosswords are not weekly — they live in the crossword repository (`npm run crossword:generate`).

**Schedule:** no GitHub Actions. The box crontab runs `scripts/weekly-cron.sh` at `0 3 * * 0` (box TZ America/Chicago = Sunday 3:00 AM Central); it runs `npm run weekly`, then commits and pushes the snapshots. Logs: `/workspace/logs/weekly-*.log`.

**In the app:** setup screens have *Puzzle: This week / Past week ▾ / Classic* plus a *Mon…Sun* day picker (solo, open lobbies, private rooms and share links). Lobbies show the chosen week. `#/archive` browses every week. Weekly puzzles use `p = 100000 + weekly_puzzles.id` in URLs/rooms.

## Connections generator v2 (category types, quotas, red herrings)

Categories live in `scripts/weekly/connectionsBank2.txt` (`type|level|category|WORDS`, ~270 categories). Types (`scripts/weekly/connectionsTypes.mjs`):
set, trivia, brand, jargon (sports/game terms), people, synonym, property ("things with…"), compound (___BALL), phrase (Break the ___), members (___ Bowl),
and the wordplay types homophone, hidden, anagram, letter.

Rules enforced by `scripts/weekly/connectionsGen2.mjs` + `connectionsWeek.mjs`:
- at most **one wordplay group** per puzzle (none in easy); each type at most once per puzzle (sets/trivia at most twice)
- **hidden-word groups in at most ~1 in 10 puzzles** (max 2 of the 21 Connections puzzles a week)
- within a week: no category reused (any difficulty), no repeated type pattern and no repeated purple type per difficulty
- exactly one valid solution (checked against every category's full word list) and conflict pairs (e.g. "Things with wings" + "Birds") never share a board
- medium: purple-level group + **≥1 red herring**; hard: two level-2/3 groups + **≥2 red herrings**
- no puzzle repeated across weeks; exact groups not reused when avoidable

Tools: `npm run connections:audit` (type mix per source), `npm run connections:validate` (checks every weekly puzzle in Supabase),
`npm run connections:regen -- --weeks 2026-10-19 --diffs medium,hard` (in-place regeneration; never touches puzzles with a recorded result or room),
`npm run connections:classic` (rebuilds the bundled classic medium/hard lists).

### Archived games
Each game in `GAME_META` (`src/lib/lobby.ts`) has `status: "active" | "archived"`. Archived games are hidden from the home cards, open-lobby list, archive week table and history tabs; direct visits to their routes redirect to the lobby (existing room links still work). Code, routes, data, DB tables and puzzles are untouched.
Currently archived: `crossword` (big crossword), `bee` (Spelling Bee).
**To restore:** change that game's `status: "archived"` to `status: "active"` in `src/lib/lobby.ts` and push to main.
