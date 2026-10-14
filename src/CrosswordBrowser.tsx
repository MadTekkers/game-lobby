import { useEffect, useState } from "react";
import { listCrosswords, playedSet, type CwMeta } from "./lib/crosswordRepo";

const SIZE_LABEL: Record<number, string> = { 7: "7×7 · ~5 min", 11: "11×11 · ~10 min", 15: "15×15 · ~30 min" };
export default function CrosswordBrowser({ selected, onSelect }: { selected: number | null; onSelect: (m: CwMeta) => void }) {
  const [size, setSize] = useState<number | 0>(0);
  const [diff, setDiff] = useState("");
  const [status, setStatus] = useState<"all" | "unplayed" | "played">("unplayed");
  const [order, setOrder] = useState<"newest" | "oldest">("newest");
  const [rows, setRows] = useState<CwMeta[] | null>(null);
  useEffect(() => { setRows(null); listCrosswords({ size: size || undefined, difficulty: diff || undefined, order }).then(setRows); }, [size, diff, order]);
  const played = playedSet();
  const shown = (rows || []).filter((r) => status === "all" || (status === "played") === played.has(r.id));
  useEffect(() => { if (shown.length && !shown.some((r) => r.id === selected)) onSelect(shown[0]); }, [rows, status]);
  const seg = <T extends string | number>(val: T, set: (v: T) => void, opts: [T, string][]) => <div className="seg">{opts.map(([v, l]) => <button key={String(v)} className={val === v ? "on" : ""} onClick={() => set(v)}>{l}</button>)}</div>;
  return (
    <div className="cw-browser">
      <div className="filters">
        {seg<number>(size, setSize, [[0, "All sizes"], [7, "7×7"], [11, "11×11"], [15, "15×15"]])}
        {seg<string>(diff, setDiff, [["", "Any"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]])}
        {seg<string>(status, (v) => setStatus(v as any), [["unplayed", "Unplayed"], ["played", "Played"], ["all", "All"]])}
        {seg<string>(order, (v) => setOrder(v as any), [["newest", "Newest"], ["oldest", "Oldest"]])}
      </div>
      <p className="muted small">{rows === null ? "Loading repository…" : `${shown.length} of ${rows.length} crosswords match`}</p>
      <div className="cw-list">
        {shown.slice(0, 120).map((r) => (
          <button key={r.id} className={`cw-item ${selected === r.id ? "on" : ""}`} onClick={() => onSelect(r)}>
            <b>#{r.id}</b><span>{SIZE_LABEL[r.size]}</span><span className={`diff ${r.difficulty}`}>{r.difficulty}</span>
            <small className="muted">{new Date(r.created_at).toLocaleDateString()}{played.has(r.id) ? " · ✓ played" : ""}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
