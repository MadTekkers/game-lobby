// Generic "coach" comparison card: the player's move vs the alternatives, sorted best -> worst, with solver/Monte Carlo metrics.
import { useState, type ReactNode } from "react";

export type CoachRow = {
  key: string; label: string;
  /** stacked bar segments, fractions summing to <= 1 */
  bar: { frac: number; cls: "good" | "mid" | "bad" }[];
  metric: string; ev: string; why: string; math: ReactNode;
  winFrac: number; evNum: number;
};
export function TrainCard({ rows, chosen, title = "Coach", sample, gapText, onClose, replay }: {
  rows: CoachRow[]; chosen: string | null; title?: string; sample: string; gapText: string; onClose: () => void;
  replay?: (key: string) => ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [rep, setRep] = useState<{ key: string; n: number } | null>(null);
  const best = rows[0]?.key;
  return (
    <div className="coach pop-in" role="dialog" aria-label="Move comparison">
      <div className="coach-h"><b>🎓 {title}</b><button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <p className={`coach-gap ${chosen && chosen !== best ? "warn" : "ok"}`}>{gapText}</p>
      {rows.map((r) => (
        <div key={r.key} className={`coach-row ${r.key === chosen ? "mine" : ""} ${open === r.key ? "open" : ""}`}>
          <button className="coach-top" onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}>
            <span className="coach-name">{r.key === best && <span className="star" title="Best move">★</span>}{r.label}{r.key === chosen && <em> you</em>}</span>
            <span className="coach-ev">{r.ev}</span>
            <span className="coach-bar">{r.bar.map((b, i) => <i key={i} className={b.cls} style={{ width: `${Math.max(0, b.frac) * 100}%` }} />)}</span>
            <span className="coach-metric">{r.metric}</span>
            <span className="coach-why">{r.why}</span>
          </button>
          {open === r.key && (
            <div className="coach-math">
              {r.math}
              {replay && <div className="coach-replay">
                <button className="pill ghost sm" onClick={() => setRep({ key: r.key, n: (rep?.n ?? 0) + 1 })}>▶ Replay with “{r.label}”</button>
                {rep?.key === r.key && <div key={rep.n}>{replay(r.key)}</div>}
              </div>}
            </div>
          )}
        </div>
      ))}
      <p className="muted tiny">{sample}</p>
    </div>
  );
}
