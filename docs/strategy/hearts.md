# Hearts strategy (as played in this app)

**Rules here** ([Pagat](https://www.pagat.com/reverse/hearts.html), [Bicycle](https://bicyclecards.com/how-to-play/hearts)):
no trumps; follow suit if you can; each ♥ is 1 point and **Q♠ is 13**; take all 26 (**shoot the moon**) and you score 0 while everyone else
gets +26. The holder of the lowest club leads it to the first trick; no ♥ or Q♠ may be thrown on the first trick unless you have nothing
else; ♥ can't be led until a heart has been played (or you hold only hearts). The game ends when someone reaches **100**; lowest score wins.
Engine: `src/cards/hearts/engine.ts`, rules + bots: `src/cards/hearts/sim.ts`.

| Seats | Deal | Passing (3 cards) |
|---|---|---|
| 4 | 13 each | left, right, across, hold — repeat ([Pagat](https://www.pagat.com/reverse/hearts.html)) |
| 3 | 17 each, **2♦ removed** ([Bicycle](https://bicyclecards.com/how-to-play/hearts)) | left, right, hold ([Pagat, "Other numbers of players"](https://www.pagat.com/reverse/hearts.html)) |
| 2 | 13 each + a 26-card **stock**: after every trick the winner draws first, then the other player; the last 13 tricks are played from hand | across, hold |

## Beginner
1. **Pass danger:** Q♠ (unless you have 4+ low spades to hide behind), A♠ and K♠ (they can be forced to catch the queen), high hearts, and
   aces/kings in short suits.
2. **Duck:** when following, play the highest card that still loses the trick. When you must win a clean trick, win it with your highest card.
3. **Dump when void:** the moment you can't follow suit, throw Q♠ — or, if it's gone, your highest heart.
4. **Lead low** in suits where higher cards are still out, so somebody else wins the trick.

## Intermediate
- **Smoke out the queen:** if you don't hold Q♠ (and hold neither A♠ nor K♠), lead low spades — whoever holds the queen will eventually
  be forced to play it under an A/K. The medium bot does this a tunable share of the time (`flush`).
- **Void a suit when passing:** passing a short club/diamond suit (with the 2♣ you'd lead anyway) gives you early chances to dump points.
- **Know where your pass went:** the three cards you passed are in the receiver's hand — the coach's simulations use that, and so should you.
- **Count hearts and spades:** 13 of each; every void someone shows is permanent (except in two-hand Hearts while the stock lasts — a draw
  can refill a void, and the simulations account for that).
- **Stop the moon:** if one player has every point so far late in the hand, take a heart trick yourself (eat 1–4 points instead of giving
  everyone else 26).

## Expert: the math behind the coach and the hard bot
- **Train mode / coach** (`src/cards/hearts/coach.ts`): for every legal card (equivalent cards — e.g. 7♣ and 6♣ when nothing between them is
  left — share one row) it samples the hidden hands consistent with what you know: your hand, every card played, voids shown, and the
  cards you passed. Every card is played on the *same* sampled deals (common random numbers) and the rest of the hand is played out by the
  card-counting bot for all seats. It reports **P(you take Q♠)**, **your expected points**, **moon chance** (yours and anyone else's), the chance you
  win the current trick, and **EV = average opponent points − your points**. Default 200 deals per card (160 per pass set); the sample size is
  printed on the card, and the gap line gives the paired standard error so you can tell a real mistake from a tie.
- **Passing** is evaluated the same way: the other hands are dealt at random, the other players pass like the medium bot, then the hand is
  played out. Candidates: your pass, the hard bot's "dump danger" pass, "three highest", "void clubs/diamonds" and "top hearts".
- **Shooting the moon** is worth +26 relative to every opponent, so it is only right when you control the hand: the bots try only when nobody
  else has points and at least `moonMin` of their remaining cards are sure winners (counted against the unseen cards).

## How the bots differ (`src/cards/hearts/sim.ts`)
| Level | Passing | Play |
|---|---|---|
| Easy | passes its three highest cards (often gives away safe low spades, keeps Q♠ danger) | 40 % of cards random, otherwise the heuristic; never runs for the moon |
| Medium | Q♠/A♠/K♠ unless spade-long, high hearts, then voids a short suit | card-counting heuristic: ducks, dumps Q♠/hearts when void, flushes the queen, blocks moons, moon runs when dominant |
| Hard | same passing (tuned `qKeep`) | determinized Monte Carlo: samples 24 hidden-hand layouts (including where its pass went) and picks the card with the best average outcome |

Self-play (`npx vitest run src/hearts.test.ts`, duplicate deals with seats swapped): **medium takes 3.0 fewer points per hand than easy**
(60 deals ×2), **hard takes 2.2 fewer than medium** (40 deals ×2). Parameters `qKeep`, `moonMin` and `flush` are tuned nightly from past-game
reviews (`src/cards/hearts/tune.ts`): e.g. if bots that kept Q♠ ate it more than 45 % of the time, they keep it only with more low spades; if
opponents shoot the moon in more than 6 % of hands, the bots flush spades earlier. Easy is never tuned.

## Tutorial mode
**Tutorial** on the setup screen deals every hand face-up (solo only — the server won't seat a second human at a tutorial table) and shows
Beginner / Intermediate / Expert tips with the coach's Monte Carlo numbers at every pass and every card. The tips use only information a
real player would have.

## Sources
- [Pagat — Hearts (rules, passing cycle, 3- and 5-player variants, shooting the moon)](https://www.pagat.com/reverse/hearts.html)
- [Bicycle Cards — How to play Hearts (3-player: remove 2♦, 17 cards each)](https://bicyclecards.com/how-to-play/hearts)
- [Wikipedia — Hearts (card game)](https://en.wikipedia.org/wiki/Hearts_(card_game))
- Joe Andrews, *Win at Hearts* (1998) — passing technique, spade management, slams (cited by Pagat)
