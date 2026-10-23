import { useLayoutEffect, useRef } from "react";
import { RANK_LABEL, SUIT_SYMBOL, isRed, type Card } from "../core.ts";
import { flyCard, type Fly } from "./fly.ts";

/** A playing card with deal-in and flip animations. card=null shows the back.
 *  `fly` makes it travel from an element (shoe/deck) in deal order instead of the generic drop-in; `rot` lays it sideways (a double). */
export function PlayingCard({ card, i = 0, small, fly, rot }: { card: Card | null; i?: number; small?: boolean; fly?: Fly | null; rot?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (fly && ref.current) flyCard(ref.current, { ...fly, flip: fly.flip ?? !!card }); }, []);
  return (
    <div ref={ref} className={`pc ${small ? "sm" : ""} ${card ? "up" : "down"} ${fly ? "fly" : ""} ${rot ? "rot" : ""}`} style={fly ? undefined : { animationDelay: `${i * 90}ms` }}>
      <div className="pc-in">
        <div className={`pc-face ${card && isRed(card) ? "red" : ""}`}>
          {card && (<><span className="pc-r">{RANK_LABEL(card[0])}<i>{SUIT_SYMBOL[card[1]]}</i></span><span className="pc-s">{SUIT_SYMBOL[card[1]]}</span></>)}
        </div>
        <div className="pc-back" />
      </div>
    </div>
  );
}
export function CardRow({ cards, small, label, fly, rotLast }: { cards: (Card | null)[]; small?: boolean; label?: string; fly?: (i: number) => Fly | null; rotLast?: boolean }) {
  return <div className="pc-row" aria-label={label}>{cards.map((c, i) => <PlayingCard key={i} card={c} i={i} small={small} fly={fly?.(i) ?? null} rot={rotLast && i === cards.length - 1 && cards.length >= 3} />)}</div>;
}
