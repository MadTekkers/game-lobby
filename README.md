# Game Lobby

Live: https://game-lobby-games.vercel.app

NYT-Games-style daily word games built with Vite + React + TypeScript, with real-time multiplayer on Supabase.

Games: **Wordle**, **Connections** (easy / medium / hard), **Mini Strands**, **Crossword** (5/10/30 min ≈ 7×7/11×11/15×15, easy/medium/hard), **The Mini** (5×5), **Spelling Bee**.

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
