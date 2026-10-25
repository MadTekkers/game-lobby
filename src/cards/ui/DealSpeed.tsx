// Deal speed slider (0.25x–3x, far right = Instant) and the replay "tap to skip" bar shown while bots/dealer play out.
import { useEffect, useSyncExternalStore } from "react";
import { dealSpeed, setDealSpeed, onDealSpeed } from "./fly";

export const useDealSpeed = () => useSyncExternalStore(onDealSpeed, dealSpeed, dealSpeed);
const INSTANT_AT = 3.25;
export const speedLabel = (v: number) => (v === 0 ? "Instant" : v < 0.7 ? "Slow" : v < 1.45 ? "Normal" : "Fast");

export function DealSpeed({ id = "deal-speed" }: { id?: string }) {
  const v = useDealSpeed(); const pos = v === 0 ? INSTANT_AT : v;
  return (
    <div className="deal-speed" onPointerDown={(e) => e.stopPropagation()}>
      <label htmlFor={id}>Deal speed</label>
      <input id={id} type="range" min={0.25} max={INSTANT_AT} step={0.05} value={pos} aria-valuetext={v === 0 ? "Instant" : `${v.toFixed(2)}x, ${speedLabel(v)}`}
        onChange={(e) => { const n = Number(e.target.value); setDealSpeed(n >= INSTANT_AT - 0.1 ? 0 : n); }} />
      <span className="ds-val">{v === 0 ? "Instant" : `${speedLabel(v)} · ${(+v.toFixed(2))}×`}</span>
      <span className="ds-presets">
        {([["Slow", 0.5], ["Normal", 1], ["Fast", 2], ["Instant", 0]] as const).map(([l, n]) => (
          <button key={l} type="button" className={`ds-p ${v === n ? "on" : ""}`} onClick={() => setDealSpeed(n)}>{l}</button>
        ))}
      </span>
    </div>
  );
}

/** Below the table: the speed slider, plus a Skip button while a replay runs. Tapping anywhere also skips. */
export function ReplayBar({ replaying, skip }: { replaying: boolean; skip: () => void }) {
  const v = useDealSpeed();
  useEffect(() => { document.documentElement.dataset.dealSpeed = v === 0 ? "instant" : String(v); }, [v]);
  useEffect(() => {
    if (!replaying) return;
    const h = (e: PointerEvent) => { const t = e.target as Element | null; if (t?.closest?.(".deal-speed, .side-panel")) return; skip(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === " ") skip(); };
    document.addEventListener("pointerdown", h, true); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("pointerdown", h, true); document.removeEventListener("keydown", k); };
  }, [replaying, skip]);
  return (
    <div className={`replay-bar ${replaying ? "on" : ""}`}>
      <DealSpeed />
      {replaying && <button type="button" className="pill ghost replay-skip" onClick={skip}>Skip ▸▸ <small>tap anywhere</small></button>}
    </div>
  );
}
