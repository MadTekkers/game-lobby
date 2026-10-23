# Spades strategy (as played in this app)

**Rules here** ([Pagat](https://www.pagat.com/auctionwhist/spades.html), [Bicycle](https://bicyclecards.com/how-to-play/spades)):
spades are always trump and can't be led until broken; bid = tricks you'll take; a made bid scores 10 × bid, each overtrick is a **bag** (+1)
and every 10 bags costs **−100**; a set loses 10 × bid; **Nil** ±100, **Blind Nil** ±200 (only when your side trails by 100+, before you
look); game to **500** (or a side falls to −200). Engine: `src/cards/spades/engine.ts`.

| Seats | Variant | Deal |
|---|---|---|
| 4 | Partnership — you and the player opposite | 13 each |
| 3 | Cutthroat — everyone for themselves | 17 each, 2♣ removed |
| 2 | Two-hand draw — look at the top of the stock, keep it or discard it and take the next ([Pagat, "Spades for Two Players"](https://www.pagat.com/auctionwhist/spades.html)) | 13 each, 26 discarded unseen |

## Beginner
1. **Count sure tricks when bidding:** each A, each K with one other card in the suit, each spade above 9 with length, plus one for every
   spade beyond the 3rd. Bid that, not your hopes.
2. **Follow suit; trump only when void.** Second hand plays low, third hand plays high.
3. **Lead your aces early** in side suits before someone runs out and trumps them.
4. **Bags are real points:** once your side is safe, play low and give tricks away. 10 bags = −100.
5. **Nil** needs a hand with no aces/kings of length, few high spades (≤ Q, ideally ≤ 9) and low cards in every suit.

## Intermediate
- **Partnership bidding:** your bids add up. If partner bid 5 and your hand is worth 3.5, bid 3 — under-bidding by half a trick costs a bag,
  over-bidding by half a trick risks −10 × team bid.
- **Covering partner's nil:** lead high in the suits partner is void in late; play your highest card when partner is forced to follow.
- **Setting:** when the opponents' bids total 10+ (partnership) every trick they don't need is a chance to set them; take tricks early.
- **Cutthroat:** with no partner, a cheap way to win is to let the bidder with the most bags pick up more bags.
- **Card counting:** know how many spades are out (13 minus what's been played and what you hold) and which suits each player has shown void.

## Expert: the math behind the coach and the hard bot
- The **coach / Train mode** (`src/cards/spades/coach.ts`) samples the hidden hands consistent with everything a real player knows —
  cards played, voids revealed by failing to follow suit, cards you held — then plays every candidate card (or bid) on the *same* sampled
  deals (common random numbers) and rolls each deal out with the medium bot's play. It reports make %, set %, expected bags, nil success,
  chance to win the current trick and expected hand points vs. the opponents (bags charged at 10 points each). Default: 200 deals per card,
  300 per bid; the number is printed on each card, and the "gap" line gives the paired standard error so you can see when two plays are a tie.
- **Bidding as estimation:** the bots' trick estimator (`Sim.estimate`) counts sure tricks, length in spades and void/ruff potential; the
  coach checks round(estimate) ± 1, nil and (when offered) blind nil.
- **Nil vs. bid:** a nil worth +100 at success probability *p* beats a bid worth *b* tricks when 200p − 100 > 10b · P(make) − 10b · (1 − P(make)).
  The coach evaluates this directly instead of using a rule of thumb.

## How the bots differ (`src/cards/spades/sim.ts`)
| Level | Bidding | Play |
|---|---|---|
| Easy | estimate + 0.4 (over-bids), never bids nil | 45 % of cards random, otherwise greedy; ignores bags |
| Medium | estimate, nil with a very weak hand | rule-based heuristic with card counting, void tracking, partner-aware covers, bag cost 3 |
| Hard | estimate, nil more often (tuned), aggressive setting | determinized Monte Carlo: samples 24 hidden-hand layouts consistent with play and picks the card with the best average result, bag cost 4 |

Self-play (`npm test`, `src/spades.test.ts`): medium beats easy by > 600 points (points − 10 × bags) over 120 hands, hard beats medium by
> 300 over 100 hands. Parameters marked as tunable (`bidOffset`, `nilMax`, `bagCost`, `setAggro`) are adjusted by the nightly tuner from
past-game reviews (`src/cards/spades/tune.ts`); easy is never tuned.

## Tutorial mode
**Tutorial** on the setup screen deals all four hands face-up (solo only — the server will not seat a second human at a tutorial table)
and shows Beginner / Intermediate / Expert tips with the coach's Monte Carlo odds at every bid and card. The tips themselves only use
information a real player would have, so they teach play you can use at a live table.

## Sources
- [Pagat — Spades (rules, nil, blind nil, sandbags, two-player and cutthroat variants)](https://www.pagat.com/auctionwhist/spades.html)
- [Bicycle Cards — How to play Spades](https://bicyclecards.com/how-to-play/spades)
- [Wikipedia — Spades (card game)](https://en.wikipedia.org/wiki/Spades_(card_game))
