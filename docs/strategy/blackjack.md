# Blackjack strategy (as played in this app)

**Table rules here:** 6 decks, reshuffle below 25 %, dealer stands on all 17s, dealer peeks on A/10, blackjack pays 3:2,
double on any first two cards (also after a split), split to 3 hands (split aces get one card), insurance 2:1, no surrender.
Rules engine: `src/cards/blackjack/engine.ts`. Under these rules the house edge against perfect basic strategy is roughly 0.4–0.5 %
([Wizard of Odds house-edge calculator](https://wizardofodds.com/games/blackjack/calculator/)).

## Beginner: the five rules that matter most
1. **Treat the dealer's hole card as a ten.** Dealer 7–A showing usually means 17+; dealer 2–6 showing must draw and busts often
   (≈35 % with a 2 up rising to ≈42 % with a 5 or 6) — the in-game coach shows the exact bust % for the current shoe.
2. **Hard 17+ always stand. Hard 11 or less always take a card** (nothing can bust you).
3. **Hard 12–16: stand against 2–6 (12 hits against 2 and 3), hit against 7–A.**
4. **Always split aces and 8s; never split 10s or 5s.**
5. **Never take insurance.** It wins only when a ten is in the hole — about 4 in 13 (≈ 30.8 %) from a full shoe, below the 33.3 %
   break-even of a 2:1 payout ([Wizard of Odds — basics](https://wizardofodds.com/games/blackjack/basics/)).

## Intermediate: full basic strategy
The bot's and the hint's rule set is the standard multi-deck S17/DAS chart (`src/cards/blackjack/strategy.ts`), the same table published by
[Wizard of Odds' strategy calculator](https://wizardofodds.com/games/blackjack/strategy/calculator/) and
[Blackjack Apprenticeship](https://www.blackjackapprenticeship.com/blackjack-strategy-charts/):
- **Doubles:** 11 vs 2–10; 10 vs 2–9; 9 vs 3–6; soft 13–14 vs 5–6; soft 15–16 vs 4–6; soft 17–18 vs 3–6.
- **Soft hands:** soft 19+ stand; soft 18 stands vs 2, 7, 8, hits vs 9–A (doubles vs 3–6); soft 17 or less never stands.
- **Pairs:** 2s/3s split vs 2–7, 4s split vs 5–6, 6s vs 2–6, 7s vs 2–7, 9s vs 2–6 and 8–9.
- Why it works: every cell is the action with the highest expected value given only your two cards and the dealer's up card.

## Expert: composition and the coach's math
- The **coach / Train mode** does not look the play up in a chart. For each legal action it simulates 20,000 hands (8,000 for tutorial tips)
  drawing from *the shoe minus every card visible on the table*, then plays the rest of the hand by basic strategy and reports win/push/lose %,
  EV per $1 and a 95 % interval (`src/cards/blackjack/sim.ts`). The sample size is printed on every card.
- Because it uses the remaining composition, it will sometimes disagree with the chart in a rich/poor shoe — these are the classic
  count-based deviations (e.g. stand 16 v 10, take insurance when over 1/3 of the unseen cards are tens) catalogued by
  [Wizard of Odds — appendix 4 (true-count indices)](https://wizardofodds.com/games/blackjack/appendix/4/).
- Insurance EV per $1 of main bet = ½ × (2·P(ten) − (1 − P(ten))): positive only when P(ten) > 1/3.

## How the bots differ
| Level | Playing | Betting |
|---|---|---|
| Easy | basic strategy, but 22 % of decisions replaced by a random hit/stand | random 10–50 |
| Medium | basic strategy with 7 % slips | flat 25 |
| Hard | perfect basic strategy | 3 % of bankroll |

## Tutorial mode
Choose **Tutorial** on the setup screen. The dealer's hole card and the next four cards of the shoe are shown face-up (solo tables only:
the server refuses a second player at a tutorial table, so nobody can use it to see a live game). At every decision you get a
beginner rule of thumb, the basic-strategy play, the simulated odds for each option, and a "peek" line saying what the face-up cards
mean — with a reminder to judge the play by the odds, not by the peek.

## Sources
- Wizard of Odds — [Blackjack basics](https://wizardofodds.com/games/blackjack/basics/), [strategy calculator](https://wizardofodds.com/games/blackjack/strategy/calculator/), [house-edge calculator](https://wizardofodds.com/games/blackjack/calculator/), [count indices](https://wizardofodds.com/games/blackjack/appendix/4/)
- [Blackjack Apprenticeship strategy charts](https://www.blackjackapprenticeship.com/blackjack-strategy-charts/)
- [Pagat — Blackjack rules and variations](https://www.pagat.com/banking/blackjack.html)
- [Wikipedia — Blackjack](https://en.wikipedia.org/wiki/Blackjack)
