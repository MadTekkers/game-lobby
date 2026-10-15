import { useState } from "react";
import { go } from "./lib/router";
import { GAME_META, MODE_LABEL, createRoom, gameUrl, type GameId, type Mode } from "./lib/lobby";
import { ensurePlayer } from "./lib/player";
import { rememberRoom } from "./lib/fx";
import CrosswordBrowser from "./CrosswordBrowser";
import { SIZE_TO_LEN } from "./lib/crosswordRepo";
import { DAYS, WEEKLY_BASE, findWeekly, thisWeek, todayDay, useWeeks, weekLabel, weeklyDiff } from "./lib/weekly";
import { parseHash } from "./lib/router";

const MODE_DESC: Record<Mode, string> = { solo: "Just you, at your own pace.", versus: "Same puzzle, private boards — race everyone live.", coop: "One shared board — solve it together." };
const LEN_DESC: Record<string, string> = { "5": "5 min · 7×7", "10": "10 min · 11×11", "30": "30 min · 15×15" };

export default function Setup({ game }: { game: GameId }) {
  const meta = GAME_META[game];
  const [mode, setMode] = useState<Mode>(meta.modes[0]);
  const [d, setD] = useState(parseHash().params.get("d") || "medium");
  const [len, setLen] = useState("10");
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cwSel, setCwSel] = useState<{ id: number; size: number; difficulty: string } | null>(null);
  const isCw = game === "crossword";
  const pre = parseHash().params;
  const weeks = useWeeks(); const cur = thisWeek();
  const [src, setSrc] = useState<"week" | "past" | "classic">(pre.get("wk") && pre.get("wk") !== cur ? "past" : "week");
  const [pastWk, setPastWk] = useState(pre.get("wk") && pre.get("wk") !== cur ? pre.get("wk")! : "");
  const [day, setDay] = useState(pre.get("day") ? Number(pre.get("day")) : todayDay());
  const past = (weeks || []).filter((w) => w !== cur);
  const wk = isCw || src === "classic" ? null : src === "week" ? cur : pastWk || past[0] || null;
  const [err, setErr] = useState("");
  const opts = isCw && cwSel ? { game, mode, d: cwSel.difficulty, len: SIZE_TO_LEN[cwSel.size], cw: cwSel.id }
    : { game, mode, d: meta.difficulty ? d : undefined, len: meta.length ? len : undefined };

  async function launch(kind: "solo" | "lobby" | "link") {
    let base: typeof opts & { p?: number; wk?: string; day?: number } = opts;
    if (wk) {
      const r = await findWeekly(wk, game, weeklyDiff(game, d), day);
      if (!r) { setErr(`No ${meta.name} puzzle for ${weekLabel(wk)} · ${DAYS[day]} yet.`); return; }
      base = { ...opts, p: WEEKLY_BASE + r.id, wk, day };
    }
    if (kind === "solo") return go(gameUrl({ ...base, mode: "solo" }));
    const me = ensurePlayer(); setBusy(true);
    const ro = { ...base, p: base.p ?? Math.floor(Math.random() * 10000) };
    const { id } = await createRoom(ro, { name: name || `${me}'s ${meta.name}`, status: kind === "lobby" ? "lobby" : "playing", private: priv });
    setBusy(false);
    const url = gameUrl({ ...ro, room: id }); rememberRoom({ room: id, game, url, name });
    go(kind === "lobby" ? `/lobby?room=${id}` : url);
  }

  return (
    <div className="page setup">
      <header className="game-header"><button className="back" onClick={() => go("/")}>‹ Lobby</button><h1>{meta.name}</h1><div className="room-bar" /></header>
      <h2 className="section">How do you want to play?</h2>
      <div className="opt-grid">
        {meta.modes.map((m) => (
          <button key={m} className={`opt ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
            <span className="opt-icon">{m === "solo" ? "👤" : m === "versus" ? "⚔️" : "🤝"}</span><b>{MODE_LABEL[m]}</b><small>{MODE_DESC[m]}</small>
          </button>
        ))}
      </div>
      {isCw && (<><h2 className="section">Pick a crossword</h2><CrosswordBrowser selected={cwSel?.id ?? null} onSelect={setCwSel} /></>)}
      {!isCw && (<><h2 className="section">Puzzle</h2>
        <div className="seg">
          <button className={src === "week" ? "on" : ""} onClick={() => setSrc("week")}>This week</button>
          <button className={src === "past" ? "on" : ""} disabled={!past.length} onClick={() => setSrc("past")}>Past week</button>
          <button className={src === "classic" ? "on" : ""} onClick={() => setSrc("classic")}>Classic (random)</button>
        </div>
        {src === "past" && <div className="name-row"><label>Week <select value={pastWk || past[0] || ""} onChange={(e) => setPastWk(e.target.value)}>{past.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}</select></label></div>}
        {src !== "classic" && <div className="seg days">{DAYS.map((x, i) => <button key={x} className={day === i ? "on" : ""} disabled={src === "week" && i > todayDay()} onClick={() => setDay(i)}>{x}</button>)}</div>}
        {wk && <p className="muted small">{weekLabel(wk)} · {DAYS[day]}{game === "mini" ? ` · ${["easy", "easy", "medium", "medium", "medium", "hard", "hard"][day]} (set by day)` : ""} — <a href="#/archive">browse the archive</a></p>}
        {err && <p className="warn">{err}</p>}</>)}
      {meta.difficulty && !isCw && !(game === "mini" && wk) && (<><h2 className="section">Difficulty</h2>
        <div className="seg">{["easy", "medium", "hard"].map((x) => <button key={x} className={d === x ? "on" : ""} onClick={() => setD(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
        {game === "connections" && <p className="muted small">Easy: everyday categories · Medium: trivia & pop culture with traps · Hard: wordplay (hidden words, homophones, ___ + word, anagrams) and red herrings.</p>}</>)}
      {meta.length && !isCw && (<><h2 className="section">Length</h2>
        <div className="seg">{["5", "10", "30"].map((x) => <button key={x} className={len === x ? "on" : ""} onClick={() => setLen(x)}>{LEN_DESC[x]}</button>)}</div></>)}
      {mode !== "solo" && (<>
        <h2 className="section">Lobby</h2>
        <div className="name-row"><label>Lobby name <input value={name} placeholder="optional" maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <label className="muted"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private (join by 4-letter code only)</label></div>
      </>)}
      <div className="controls big">
        {mode === "solo" ? <button className="pill xl" onClick={() => launch("solo")}>Play</button> : (<>
          <button className="pill xl" disabled={busy} onClick={() => launch("lobby")}>Create lobby</button>
          <button className="pill ghost xl" disabled={busy} onClick={() => launch("link")}>Start now & share link</button>
        </>)}
      </div>
    </div>
  );
}
