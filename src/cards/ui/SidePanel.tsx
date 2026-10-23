// Tutorial / Train panel: a sticky right column on wide screens, a collapsible bottom sheet on phones.
// The sheet starts collapsed to a slim handle; when expanded it scrolls the table so the player's own hand stays above it.
import { useEffect, useRef, useState, type ReactNode } from "react";

export type PanelTab = { id: string; label: string; badge?: string | number | null; body: ReactNode; peek?: string | null };
const wideQ = "(min-width: 960px)";
export const useWide = () => {
  const [w, setW] = useState(() => typeof matchMedia === "function" && matchMedia(wideQ).matches);
  useEffect(() => { const m = matchMedia(wideQ); const f = () => setW(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return w;
};

export function SidePanel({ tabs, active, onTab, keepVisible, attention }: {
  tabs: PanelTab[]; active: string; onTab: (id: string) => void;
  /** selector of the element that must stay visible above the phone sheet (the player's hand + actions) */
  keepVisible?: string;
  /** bumping this (e.g. a new coach card) expands the sheet on phones */
  attention?: string | number | null;
}) {
  const wide = useWide();
  const [open, setOpen] = useState(() => localStorage.getItem("cards_sheet") === "1");
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { localStorage.setItem("cards_sheet", open ? "1" : "0"); }, [open]);
  useEffect(() => { if (attention != null && attention !== "") setOpen(true); }, [attention]);
  // phone sheet: pad the page so nothing is trapped under it, and lift the hand above it
  useEffect(() => {
    if (wide) { document.body.style.paddingBottom = ""; return; }
    const h = ref.current?.getBoundingClientRect().height ?? 0;
    document.body.style.paddingBottom = `${Math.ceil(h) + 12}px`;
    if (open && keepVisible) {
      const els = [...document.querySelectorAll(keepVisible)]; const sheetTop = innerHeight - h;
      if (els.length) {
        const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom)), top = Math.min(...els.map((e) => e.getBoundingClientRect().top));
        if (bottom > sheetTop - 8) scrollBy({ top: Math.min(bottom - (sheetTop - 12), Math.max(0, top - 8)), behavior: "smooth" });
      }
    }
    return () => { document.body.style.paddingBottom = ""; };
  }, [open, wide, active, keepVisible, attention, tabs.length]);
  const cur = tabs.find((t) => t.id === active) ?? tabs[0];
  if (!cur) return null;
  const expanded = wide || open;
  return (
    <aside ref={ref} className={`side-panel ${wide ? "wide" : "sheet"} ${expanded ? "open" : "closed"}`} aria-label="Tutorial and training panel">
      <div className="sp-head">
        {!wide && <button className="sp-grab" aria-expanded={open} aria-label={open ? "Collapse panel" : "Expand panel"} onClick={() => setOpen(!open)}><i /></button>}
        <div className="sp-tabs" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === cur.id} className={`sp-tab ${t.id === cur.id ? "on" : ""}`} onClick={() => { onTab(t.id); if (!wide) setOpen(true); }}>
            {t.label}{t.badge != null && t.badge !== "" && <span className="sp-badge">{t.badge}</span>}</button>)}
        </div>
        {!wide && <button className="sp-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Collapse panel" : "Expand panel"}>{open ? "▾" : "▴"}</button>}
      </div>
      {!expanded && cur.peek && <button className="sp-peek" onClick={() => setOpen(true)}>{cur.peek}</button>}
      {expanded && <div className="sp-body" role="tabpanel">{cur.body}</div>}
    </aside>
  );
}
