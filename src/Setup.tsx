import { useState } from "react";
import { go } from "./lib/router";
import { GAME_META, MODE_LABEL, createRoom, gameUrl, type GameId, type Mode } from "./lib/lobby";
import { ensurePlayer } from "./lib/player";
import { rememberRoom } from "./lib/fx";
import CrosswordBrowser from "./CrosswordBrowser";
import { SIZE_TO_LEN } from "./lib/crosswordRepo";

const MODE_DESC: Record<Mode, string> = { solo: "Just you, at your own pace.", versus: "Same puzzle, private boards — race everyone live.", coop: "One shared board — solve it together." };
const LEN_DESC: Record<string, string> = { "5": "5 min · 7×7", "10": "10 min · 11×11", "30": "30 min · 15×15" };

export default function Setup({ game }: { game: GameId }) {
  const meta = GAME_META[game];
  const [mode, setMode] = useState<Mode>(meta.modes[0]);
  const [d, setD] = useState("medium");
  const [len, setLen] = useState("10");
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cwSel, setCwSel] = useState<{ id: number; size: number; difficulty: string } | null>(null);
  const isCw = game === "crossword";
  const opts = isCw && cwSel ? { game, mode, d: cwSel.difficulty, len: SIZE_TO_LEN[cwSel.size], cw: cwSel.id }
    : { game, mode, d: meta.difficulty ? d : undefined, len: meta.length ? len : undefined };

  async function launch(kind: "solo" | "lobby" | "link") {
    if (kind === "solo") return go(gameUrl({ ...opts, mode: "solo" }));
    const me = ensurePlayer(); setBusy(true);
    const ro = { ...opts, p: Math.floor(Math.random() * 10000) };
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
      {meta.difficulty && !isCw && (<><h2 className="section">Difficulty</h2>
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
