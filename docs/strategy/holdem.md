# Texas Hold'em strategy (as played in this app)

**Rules here** ([PokerNews rules](https://www.pokernews.com/poker-rules/texas-holdem.htm), [Wikipedia](https://en.wikipedia.org/wiki/Texas_hold_%27em),
[TDA rules](https://www.pokertda.com/view-poker-tda-rules/)): no-limit, blinds **5/10**, buy-in **1,000** play chips (or your bankroll if
it's smaller), 2–8 seats. Two hole cards each, then flop (3), turn (1), river (1), a burn card before each street. Best five of seven wins
([hand rankings](https://en.wikipedia.org/wiki/Hand_rankings)); an ace plays low in the wheel A-2-3-4-5. Heads-up, the button posts the small
blind and acts first pre-flop. A raise must be at least the last full raise; a **short all-in does not reopen** betting to players who
already acted (TDA). All-ins make **side pots** split by contribution level; odd chips go to the first winner left of the button; uncalled
bets are returned. Hole cards are shown only at showdown — folded hands are never revealed.
Engine: `src/cards/holdem/engine.ts`, evaluator: `eval.ts`, bots + equity: `sim.ts`, coach: `coach.ts`, tuner: `tune.ts`.

## Beginner
1. **Play few hands, play them hard.** Score your two cards with the [Chen formula](https://www.thepokerbank.com/strategy/basic/starting-hand-selection/chen-formula/)
   (best card: A=10, K=8, Q=7, J=6, below that half its rank; pairs double, min 5; +2 suited; −1/−2/−4/−5 for 1/2/3/4+ gaps; +1 for
   connected/one-gap cards below Q). Open-raise from **early ≥ 9, middle ≥ 8, late (cutoff/button) ≥ 6, blinds ≥ 7** — those are the
   chart thresholds the medium and hard bots use.
2. **Raise, don't limp.** Open to ~3 big blinds; if someone raised before you, re-raise (3-bet) to ~3× with your best hands or fold.
3. **Position matters** ([Wikipedia: position](https://en.wikipedia.org/wiki/Position_(poker))): acting last means you see what everyone
   did first, so you can play more hands on the button than under the gun.
4. **Don't pay off big bets with one pair** on a scary board (four to a flush or straight, paired board).

## Intermediate
- **Pot odds** ([Wikipedia](https://en.wikipedia.org/wiki/Pot_odds)): to call *c* into a pot of *P* you need equity ≥ *c* / (*P* + *c*).
  Calling 50 into 150 needs 25%.
- **Outs and the rule of 4 and 2** ([PokerBank](https://www.thepokerbank.com/strategy/mathematics/pot-odds/4-2/),
  [exact table](https://www.deucescracked.com/blog/rule-of-4-and-2-accuracy-exact-outs-data)): outs × 4 ≈ % to hit by the river from the
  flop, outs × 2 from the turn. A flush draw (9 outs) is ~35% flop→river and ~19.6% turn→river; an open-ender (8) ~31.5%. The tutorial
  shows your outs (cards that improve you to two pair or better *using your hole cards*, not ones that only help the board).
- **Continuation bet:** the pre-flop raiser bets ~⅓–⅔ pot on many flops; opponents miss the flop about two-thirds of the time.
- **Semi-bluff** ([Wikipedia](https://en.wikipedia.org/wiki/Semi-bluff)) your draws: betting wins when they fold *and* when you hit.
- **Value-bet thinly in position;** check-call more out of position.

## Expert
- **Think in ranges, not hands.** The bots and the coach both narrow every opponent's range from their actions: a pre-flop raiser is
  sampled from Chen ≥ 8, a caller from ≥ 5, everyone else ≥ 3; someone who bet or raised this street must hold a pair or a draw.
- **Equity by simulation** ([Monte Carlo method](https://en.wikipedia.org/wiki/Monte_Carlo_method)): every probability in the coach and
  hints is computed live — random run-outs against range-sampled opponents, with the sample count printed (400 run-outs by default;
  exact enumeration when ≤ 2 board cards remain against known hands in tutorial "peek"). Nothing is a hard-coded table.
- **Fold equity:** a raise's EV = P(fold) × pot + P(call) × (equity × final pot − your extra chips). The coach models an opponent as
  calling when their hand strength beats the price you offer them by 8 points, so bigger bets fold out more but risk more.
- **[Fundamental theorem of poker](https://en.wikipedia.org/wiki/Fundamental_theorem_of_poker)** (Sklansky): you gain whenever opponents
  play differently than they would if they could see your cards — which is exactly what the Train card measures.
- **Bluff frequency:** balance — never-bluff players get folded to, always-bluff players get called
  ([Wikipedia: bluff](https://en.wikipedia.org/wiki/Bluff_(poker))).

## Bots (`src/cards/holdem/sim.ts`)
| Level | Pre-flop | Post-flop | Character |
|---|---|---|---|
| Easy | Chart loosened by 4 Chen points; calls a lot | crude made-hand strength, no simulation, 2% bluffs, seldom raises | calling station |
| Medium | Position chart (above) | 160-sample Monte Carlo equity vs ranges, calls when equity ≥ pot odds, c-bets, semi-bluffs, 6% bluffs | solid TAG |
| Hard | Chart tightened at short tables; heads-up opens Chen ≥ 4, flats ≥ 5 | 360 samples, tighter opponent ranges from betting history, 95% aggression with value hands, thin value bets | aggressive regular |

Measured by **duplicate** heads-up self-play ([duplicate poker](https://en.wikipedia.org/wiki/Duplicate_poker): same decks, seats
swapped, so card luck cancels) in `src/holdem.test.ts`: **medium beats easy by +0.66 bb/hand** (800 deals) and **hard beats medium by
+0.37 bb/hand** (1,500 deals); during tuning hard was +0.29 bb/hand heads-up and +0.19 at 6-max.

## Train mode & tutorial
- **Train:** after each decision the comparison card shows your move and up to 3 alternatives (fold / call or check / raise sizes:
  3 bb or 3× pre-flop, ⅓ and ⅔ pot post-flop, pot, all-in) with **EV in chips and bb**, **equity**, **fold-success %** for raises, a
  bar (fold / called-and-win / called-and-lose), the gap to the best move, why, the math (sample size stated) and a replay of the run-out.
  All options share the same random run-outs (common random numbers), so the gaps are not sampling noise.
- **Tutorial:** every hand face-up, with Beginner (Chen + position), Intermediate (outs, rule of 4/2, pot odds), Expert (best-EV option
  from simulation) and Peek (your exact equity against the revealed hands) tips at every decision.

## Self-improvement
The nightly tuner (`scripts/cards/nightly-tune.sh`) reviews logged human-vs-bot hands (`card_hands`) per level: if bot bluffs succeed
< 30% (≥ 25 bluffs) the bluff rate drops 0.02, > 55% it rises; if bots win < 42% of showdowns (≥ 40) they tighten their calling slack,
> 62% they loosen; VPIP > 45% with a losing result (≥ 60 hands) tightens opening by 0.5 Chen. For medium, each candidate must also not lose to the current
parameters in a 40-deal duplicate self-play screen before it's saved to `bot_params`. Easy is never tuned (it's meant to be soft).
