import { useState } from "react";
import { go } from "../lib/router";
import { GAME_META, createRoom, gameUrl, type GameId, type Mode } from "../lib/lobby";
import { ensurePlayer } from "../lib/player";
import { rememberRoom } from "../lib/fx";
import "./cards.css";

const BOT_DESC: Record<string, string> = { easy: "Loose, makes mistakes", medium: "Mostly by the book", hard: "Sharp, no mistakes" };

/** Setup screen for the card games: solo vs bots or a live table, seat count, bot level, train mode. */
export default function CardSetup({ game }: { game: GameId }) {
  const meta = GAME_META[game];
  const [mode, setMode] = useState<Mode>("solo");
  const [seats, setSeats] = useState(3);
  const [bot, setBot] = useState("medium");
  const [train, setTrain] = useState(false);
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const opts = { game, mode, seats, bot, train: train ? 1 : undefined };
  async function launch(kind: "solo" | "lobby" | "link") {
    if (kind === "solo") return go(gameUrl({ ...opts, mode: "solo" }));
    const me = ensurePlayer(); setBusy(true);
    const { id } = await createRoom(opts, { name: name || `${me}'s ${meta.name} table`, status: kind === "lobby" ? "lobby" : "playing", private: priv });
    setBusy(false);
    const url = gameUrl({ ...opts, room: id }); rememberRoom({ room: id, game, url, name });
    go(kind === "lobby" ? `/lobby?room=${id}` : url);
  }
  return (
    <div className="page setup card-setup">
      <header className="game-header"><button className="back" onClick={() => go("/")}>‹ Lobby</button><h1>{meta.name}</h1><div className="room-bar" /></header>
      <h2 className="section">How do you want to play?</h2>
      <div className="opt-grid">
        <button className={`opt ${mode === "solo" ? "on" : ""}`} onClick={() => setMode("solo")}><span className="opt-icon">🤖</span><b>Solo vs computer</b><small>You and bots at the table.</small></button>
        <button className={`opt ${mode === "live" ? "on" : ""}`} onClick={() => setMode("live")}><span className="opt-icon">🃏</span><b>Live table</b><small>Real people, one table — empty seats get bots, and a bot gives up its seat when someone joins.</small></button>
      </div>
      <h2 className="section">Seats at the table</h2>
      <div className="seg">{[2, 3, 4].map((n) => <button key={n} className={seats === n ? "on" : ""} onClick={() => setSeats(n)}>{n}<small>{mode === "solo" ? `you + ${n - 1} bot${n > 2 ? "s" : ""}` : "players"}</small></button>)}</div>
      <p className="muted small">The dealer is always the computer. Seats without a person are played by bots.</p>
      <h2 className="section">Bot level</h2>
      <div className="seg">{["easy", "medium", "hard"].map((x) => <button key={x} className={bot === x ? "on" : ""} onClick={() => setBot(x)}>{x[0].toUpperCase() + x.slice(1)}<small>{BOT_DESC[x]}</small></button>)}</div>
      <h2 className="section">Coaching</h2>
      <label className="name-row"><span><input type="checkbox" checked={train} onChange={(e) => setTrain(e.target.checked)} /> <b>Train mode</b> — after every decision, compare your move with the alternatives (win/push/lose % and EV from 20,000 simulated hands each).</span></label>
      <p className="muted small">The 💡 Hint button (basic strategy + the same simulation) is always available.</p>
      {mode === "live" && (<>
        <h2 className="section">Lobby</h2>
        <div className="name-row"><label>Table name <input value={name} placeholder="optional" maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <label className="muted"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private (join by 4-letter code only)</label></div>
      </>)}
      <p className="muted small">Play money only: everyone starts with 🪙 1,000 chips, with a free top-up if you go broke.</p>
      <div className="controls big">
        {mode === "solo" ? <button className="pill xl" onClick={() => launch("solo")}>Take a seat</button> : (<>
          <button className="pill xl" disabled={busy} onClick={() => launch("lobby")}>Create lobby</button>
          <button className="pill ghost xl" disabled={busy} onClick={() => launch("link")}>Start now & share link</button>
        </>)}
      </div>
    </div>
  );
}
