# Game Maker

NYT-Games-style daily word games built with Vite + React + TypeScript, with real-time multiplayer on Supabase.

- **Mini Strands** – 6×5 board, drag/tap adjacent letters (diagonals ok), spangram spans the board, 3 hints, every letter used once.
- **Wordle** – 6 guesses, flip-reveal animation, 510 answers / 12.6k valid guesses.
- **Connections** – 4 groups of 4 with difficulty colors, 4 mistakes, one-away, shuffle.
- **Multiplayer** – "Play with a friend" creates a shareable link. Wordle & Strands: independent play on the same puzzle with the opponent's live progress. Connections: one shared board, per-tile selection locks (Realtime broadcast/presence), compare-and-swap submit lock, shared mistakes.
- **History & leaderboard** – per-session and global results with completion time.
- **Weekly puzzles** – Connections puzzles past the curated 60 are generated deterministically at runtime from the category bank, so new ones appear automatically each day/week. `npm run weekly` appends 7 Connections + new Strands boards to the JSON files; `docs/weekly-puzzles.yml` is a ready GitHub Actions workflow (move it to `.github/workflows/` — pushing it needs a token with `workflow` scope).

```
npm i && npm test && npm run build
```
Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key).
