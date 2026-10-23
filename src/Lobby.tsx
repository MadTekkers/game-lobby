import { useEffect, useState } from "react";
import { go } from "./lib/router";
import { useLobby, gameUrl, GAME_META, optsLabel } from "./lib/lobby";
import { ensurePlayer, getPlayer } from "./lib/player";
import { playerColor, initials, rememberRoom, rememberPeers, CAPS } from "./lib/fx";

export function Avatar({ name: raw, size = 34 }: { name: string; size?: number }) {
  const name = raw === "You" ? getPlayer() || "You" : raw;
  return <span className="avatar" title={name} style={{ background: playerColor(name), width: size, height: size, fontSize: Math.max(9, size * 0.4), minWidth: size }}>{initials(name)}</span>;
}

export default function Lobby({ room }: { room: string }) {
  useEffect(() => { ensurePlayer(); }, []);
  const { row, players, start } = useLobby(room);
  const [copied, setCopied] = useState(false);
  const me = getPlayer();
  const url = row ? gameUrl({ ...row.params, room }) : "";
  useEffect(() => { if (row?.game === "spywords") go(url); }, [row?.game]); // Spy Words has its own team-picking lobby inside the room
  useEffect(() => { if (row && row.status !== "lobby") { rememberRoom({ room, game: row.game, url, name: row.name || undefined }); rememberPeers(players.filter((p) => p !== me)); go(url); } }, [row?.status]);
  if (!row) return <p className="center muted">Loading lobby…</p>;
  const cap = row.params.mode === "versus" ? CAPS.versus : CAPS.shared;
  const isHost = row.host === me;
  const link = `${location.origin}/#/lobby?room=${room}`;
  return (
    <div className="page lobby">
      <header className="game-header"><button className="back" onClick={() => go("/")}>‹ Lobby</button><h1>{row.name || "Lobby"}</h1><div className="room-bar" /></header>
      <div className="lobby-card">
        <div className="lobby-meta"><b>{GAME_META[row.game].name}</b> · {optsLabel(row.params)}</div>
        {row.code && <div className="code">Code <b>{row.code}</b></div>}
        <div className="players">{players.map((p) => <div key={p} className="player-chip pop-in"><Avatar name={p} /> {p}{p === row.host && " 👑"}</div>)}</div>
        <p className="muted">{players.length}/{cap} players{players.length > cap ? " — room is over capacity" : ""}</p>
        {isHost ? <button className="pill xl" onClick={start} disabled={players.length > cap}>Start game</button> : <p className="waiting">Waiting for {row.host} to start<span className="dots" /></p>}
        <div className="controls"><button className="pill ghost" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { prompt("Copy link", link); } }}>{copied ? "Copied!" : "Copy invite link"}</button></div>
      </div>
    </div>
  );
}
