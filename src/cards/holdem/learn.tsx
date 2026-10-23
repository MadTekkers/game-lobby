// Beginner refresher cards for the Hold'em tutorial: tappable glossary terms + a hand-rankings reference.
import { useState } from "react";
import { PlayingCard } from "../ui/PlayingCard";

export type Term = { id: string; title: string; icon: string; body: string };
export const TERMS: Term[] = [
  { id: "button", icon: "🔘", title: "Button (dealer)", body: "The white “D” disc marks the dealer position. It moves one seat to the left every hand. The button acts last on the flop, turn and river — the best seat at the table." },
  { id: "blinds", icon: "🪙", title: "Blinds", body: "Forced bets that start the pot: the small blind (SB) is the seat left of the button, the big blind (BB) the next seat. Pre-flop, action starts left of the big blind." },
  { id: "preflop", icon: "🂠", title: "Pre-flop", body: "Everyone gets two private hole cards, then the first betting round. Fold weak hands; play strong ones (pairs, big aces, suited broadways) more often from late position." },
  { id: "flop", icon: "🃏", title: "The flop", body: "The dealer burns one card face down, then turns three community cards face up. Everyone combines their two hole cards with the board. Second betting round, starting left of the button." },
  { id: "turn", icon: "4️⃣", title: "The turn", body: "Burn one, then a fourth community card. Bets usually get bigger here: there's only one card left to come." },
  { id: "river", icon: "5️⃣", title: "The river", body: "Burn one, then the fifth and last community card. No more cards will come, so your hand is final — the last betting round decides whether there's a showdown." },
  { id: "pot", icon: "💰", title: "The pot", body: "All chips bet this hand. At the end of each betting round the bets in front of players are pushed into the middle. The winner (or winners, on a tie) takes it." },
  { id: "sidepot", icon: "🧺", title: "Side pots", body: "When a player is all-in for less, they can only win what they matched from each opponent (the main pot). Extra bets between the others go into a side pot that the all-in player can't win." },
  { id: "actions", icon: "🎛️", title: "Check · call · raise · fold", body: "Check: pass without betting (only when nobody has bet). Call: match the current bet. Raise: increase it (at least by the last raise). Fold: give up your hand and anything you've put in." },
  { id: "allin", icon: "🚀", title: "All-in", body: "Betting every chip you have in front of you. You can't be forced out of the hand after that; if others keep betting, the extra goes to a side pot." },
  { id: "position", icon: "🧭", title: "Position", body: "Acting later is an advantage: you see what others do before you decide. Early position (just left of the blinds) should play tight; the button and cutoff can play more hands." },
  { id: "kicker", icon: "🦶", title: "Kicker", body: "The side card that breaks ties. With A-K vs A-Q on an A-7-2 board, both have a pair of aces — the king kicker wins. Only your best five cards count." },
  { id: "showdown", icon: "🎭", title: "Showdown", body: "If two or more players are left after the river betting, hands are turned over. Best five-card hand from the seven available wins; exact ties split the pot." },
];
// 7-card frequencies (best five of seven) from Wikipedia, "Poker probability".
export const RANKINGS: { name: string; cards: string[]; freq: string; note: string }[] = [
  { name: "Royal flush", cards: ["AS", "KS", "QS", "JS", "TS"], freq: "0.0032%", note: "A-K-Q-J-10, one suit" },
  { name: "Straight flush", cards: ["9H", "8H", "7H", "6H", "5H"], freq: "0.0279%", note: "Five in a row, one suit" },
  { name: "Four of a kind", cards: ["QC", "QD", "QH", "QS", "4D"], freq: "0.168%", note: "Quads" },
  { name: "Full house", cards: ["KS", "KH", "KD", "7C", "7S"], freq: "2.60%", note: "Three + a pair" },
  { name: "Flush", cards: ["AD", "JD", "8D", "5D", "2D"], freq: "3.03%", note: "Five of one suit" },
  { name: "Straight", cards: ["TC", "9D", "8S", "7H", "6C"], freq: "4.62%", note: "Five in a row (A-2-3-4-5 counts)" },
  { name: "Three of a kind", cards: ["8S", "8D", "8C", "KH", "3S"], freq: "4.83%", note: "Trips / a set" },
  { name: "Two pair", cards: ["JH", "JC", "4S", "4D", "AS"], freq: "23.5%", note: "Kicker breaks ties" },
  { name: "Pair", cards: ["TS", "TH", "KD", "6C", "3H"], freq: "43.8%", note: "" },
  { name: "High card", cards: ["AH", "QD", "9S", "6C", "3D"], freq: "17.4%", note: "Nothing made — highest card plays" },
];

/** Which refresher card fits the moment. */
export function contextTerm(o: { street: number; phase: string; handNo: number; sidePots: boolean; allIn: boolean; showdown: boolean }) {
  if (o.phase === "handover") return o.sidePots ? "sidepot" : o.showdown ? "showdown" : "pot";
  if (o.allIn) return "allin";
  if (o.street > 0) return ["preflop", "flop", "turn", "river"][o.street];
  return ["preflop", "blinds", "button", "position"][o.handNo % 4];
}

export function TermCard({ t, open, onToggle, hot }: { t: Term; open: boolean; onToggle: () => void; hot?: boolean }) {
  return (
    <button className={`lc ${open ? "open" : ""} ${hot ? "hot" : ""}`} aria-expanded={open} onClick={onToggle}>
      <span className="lc-t"><span aria-hidden>{t.icon}</span> {t.title}{hot && <em> now</em>}</span>
      {open && <span className="lc-b">{t.body}</span>}
    </button>
  );
}

export function LearnCards({ hot }: { hot: string | null }) {
  const [open, setOpen] = useState<string | null>(hot);
  const [ranks, setRanks] = useState(false);
  const hotT = TERMS.find((t) => t.id === hot);
  return (
    <div className="learn">
      {hotT && <div className="lc-now"><span className="tiny">Right now at the table</span><TermCard t={hotT} open onToggle={() => {}} hot /></div>}
      <button className={`lc rank ${ranks ? "open" : ""}`} aria-expanded={ranks} onClick={() => setRanks(!ranks)}><span className="lc-t">🏆 Hand rankings (best → worst)</span></button>
      {ranks && <ol className="rk">{RANKINGS.map((r) => (
        <li key={r.name}><div className="rk-h"><b>{r.name}</b><span className="tiny">{r.freq} of 7-card hands</span></div>
          <div className="rk-c">{r.cards.map((c) => <PlayingCard key={c} card={c} small />)}</div>{r.note && <span className="tiny">{r.note}</span>}</li>))}
        <li className="tiny">Frequencies: Wikipedia, “Poker probability” (best five of seven cards).</li></ol>}
      <div className="lc-grid">{TERMS.filter((t) => t.id !== hot).map((t) => <TermCard key={t.id} t={t} open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)} />)}</div>
    </div>
  );
}
