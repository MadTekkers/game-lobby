// Shared trick-taking table (Spades, Hearts): seats around a felt, the current trick in the middle, your hand fanned at the bottom.
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "../../Lobby";
import { PlayingCard, CardRow } from "./PlayingCard";
import { RANK_LABEL, SUIT_SYMBOL, type Card } from "../core";

export const cardName = (c: Card) => `${RANK_LABEL(c[0])}${SUIT_SYMBOL[c[1]]}`;
export type SeatInfo = { name: string; kind: string; line: ReactNode; count: number; cards?: Card[] | null; pending?: string | null; badge?: ReactNode };
const POS: Record<number, string[]> = { 2: ["s", "n"], 3: ["s", "w", "e"], 4: ["s", "w", "n", "e"] };
export const relPos = (n: number, me: number, i: number) => POS[n][(i - me + n) % n];

export function TrickTable({ n, me, seats, trick, trickSeats, actor, deadline, timeoutMs = 30000, center, trickKey }: {
  n: number; me: number; seats: SeatInfo[]; trick: Card[]; trickSeats: number[]; actor: number; deadline: number | null; timeoutMs?: number; center?: ReactNode; trickKey: string | number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!deadline) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, [deadline]);
  const secs = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  return (
    <div className={`tt n${n}`}>
      {seats.map((s, i) => i === me ? null : (
        <div key={i} className={`tt-seat ${relPos(n, me, i)} ${actor === i ? "turn" : ""} ${s.kind}`}>
          <div className="tt-who"><Avatar name={s.name} size={24} /><b className="nm">{s.name}</b></div>
          <div className="tt-line">{s.line}</div>
          {s.cards ? <div className="tt-open"><CardRow cards={s.cards} small /></div> : <div className="tt-backs" aria-label={`${s.count} cards`}><span className="tt-back" />×{s.count}</div>}
          {s.badge}
          {s.pending && <div className="tiny">↪ {s.pending} next hand</div>}
          {actor === i && secs !== null && <div className="clock"><i style={{ width: `${Math.min(100, (secs * 1000 / timeoutMs) * 100)}%` }} /></div>}
        </div>))}
      <div className="tt-center" key={trickKey}>
        {trick.map((c, k) => <div key={c} className={`tt-play ${relPos(n, me < 0 ? 0 : me, trickSeats[k])}`} style={{ zIndex: k + 1 }}><PlayingCard card={c} small /></div>)}
        {center && <div className="tt-msg">{center}</div>}
      </div>
    </div>
  );
}

/** Your hand, overlapping to fit the width (13–17 cards at 320px). Legal cards lift; others dim on your turn. */
export function HandFan({ cards, legal, onPick, disabled, hinted, selected, marked }: { cards: Card[]; legal?: Card[] | null; onPick?: (c: Card) => void; disabled?: boolean; hinted?: Card | Card[] | null; selected?: Card[]; marked?: Card[] }) {
  const [w, setW] = useState(() => Math.min(window.innerWidth, 560));
  useEffect(() => { const f = () => setW(Math.min(window.innerWidth, 560)); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  const cw = w < 400 ? 44 : 50; const avail = w - 28;
  const step = cards.length > 1 ? Math.min(cw + 2, (avail - cw) / (cards.length - 1)) : cw;
  return (
    <div className="fan" style={{ ["--step" as string]: `${step - cw}px` }}>
      {cards.map((c, i) => { const ok = !legal || legal.includes(c);
        return <button key={c} className={`fan-c ${legal ? (ok ? "ok" : "no") : ""} ${hinted === c || (Array.isArray(hinted) && hinted.includes(c)) ? "hinted" : ""} ${selected?.includes(c) ? "sel" : ""} ${marked?.includes(c) ? "recv" : ""}`} disabled={disabled || !ok || !onPick} onClick={() => onPick?.(c)} aria-label={cardName(c)}><PlayingCard card={c} i={i} /></button>; })}
    </div>
  );
}

/** Tutorial panel: the same position explained at three depths, with the Monte Carlo numbers behind the expert line. */
export function TutorTips({ tips, busy, sample }: { tips: { tier: string; text: ReactNode }[] | null; busy?: boolean; sample?: string }) {
  return (
    <div className="tutor pop-in">
      <div className="tutor-h">📘 Tutorial {busy && <span className="muted tiny">simulating…</span>}</div>
      {tips?.map((t) => <div key={t.tier} className="tutor-row"><span className={`tier ${t.tier.toLowerCase()}`}>{t.tier}</span><span>{t.text}</span></div>)}
      {sample && <p className="muted tiny">{sample}</p>}
    </div>
  );
}
