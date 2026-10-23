import { RANK_LABEL, SUIT_SYMBOL, isRed, type Card } from "../core.ts";

/** A playing card with deal-in and flip animations. card=null shows the back. */
export function PlayingCard({ card, i = 0, small }: { card: Card | null; i?: number; small?: boolean }) {
  return (
    <div className={`pc ${small ? "sm" : ""} ${card ? "up" : "down"}`} style={{ animationDelay: `${i * 90}ms` }}>
      <div className="pc-in">
        <div className={`pc-face ${card && isRed(card) ? "red" : ""}`}>
          {card && (<><span className="pc-r">{RANK_LABEL(card[0])}<i>{SUIT_SYMBOL[card[1]]}</i></span><span className="pc-s">{SUIT_SYMBOL[card[1]]}</span></>)}
        </div>
        <div className="pc-back" />
      </div>
    </div>
  );
}
export function CardRow({ cards, small, label }: { cards: (Card | null)[]; small?: boolean; label?: string }) {
  return <div className="pc-row" aria-label={label}>{cards.map((c, i) => <PlayingCard key={i} card={c} i={i} small={small} />)}</div>;
}
