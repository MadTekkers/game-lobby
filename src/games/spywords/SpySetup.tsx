import { useState } from "react";
import { go } from "../../lib/router";
import { createRoom, gameUrl } from "../../lib/lobby";
import { ensurePlayer } from "../../lib/player";
import { rememberRoom } from "../../lib/fx";
import "./spywords.css";

/** Spy Words room creation: pick Classic (teams) or Duo co-op, then everyone picks seats inside the room. */
export default function SpySetup() {
  const [mode, setMode] = useState<"versus" | "coop">("versus");
  const [name, setName] = useState(""); const [priv, setPriv] = useState(false); const [busy, setBusy] = useState(false);
  const create = async () => {
    const me = ensurePlayer(); setBusy(true);
    const o = { game: "spywords" as const, mode, p: 0 };
    const { id } = await createRoom(o, { name: name || `${me}'s Spy Words`, status: "lobby", private: priv });
    const url = gameUrl({ ...o, room: id }); rememberRoom({ room: id, game: "spywords", url, name }); go(url);
  };
  return (
    <div className="page setup sw">
      <header className="game-header"><button className="back" onClick={() => go("/")}>‹ Lobby</button><h1>Spy Words</h1><div className="room-bar" /></header>
      <h2 className="section">Pick a mode</h2>
      <div className="opt-grid">
        <button className={`opt ${mode === "versus" ? "on" : ""}`} onClick={() => setMode("versus")}><span className="opt-icon">🕵️</span><b>Classic · Red vs Blue</b><small>4+ players. Two teams, one spymaster each. Find your agents, avoid the assassin.</small></button>
        <button className={`opt ${mode === "coop" ? "on" : ""}`} onClick={() => setMode("coop")}><span className="opt-icon">🤝</span><b>Duo co-op</b><small>2 players. Each sees half of the key — find all 15 agents together in 9 turns.</small></button>
      </div>
      <h2 className="section">Room</h2>
      <div className="name-row"><label>Room name <input value={name} placeholder="optional" maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="muted"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private (join by code / link only)</label></div>
      <p className="muted small">You'll pick teams and spymasters inside the room. Share the invite link — great over FaceTime.</p>
      <div className="controls big"><button className="pill xl" disabled={busy} onClick={create}>Create room</button></div>
    </div>
  );
}
