import { useState } from "react";
import { useRoute, go } from "./lib/router";
import { getPlayer, setPlayer } from "./lib/player";
import StrandsPage from "./games/Strands";
import WordlePage from "./games/Wordle";
import ConnectionsPage from "./games/Connections";
import CrosswordPage from "./games/Crossword";
import BeePage from "./games/Bee";
import History from "./History";
import Archive from "./Archive";
import Setup from "./Setup";
import Lobby, { Avatar } from "./Lobby";
import { gameUrl, GAME_META, optsLabel, findByCode, useOpenLobbies, useSitePresence, type GameId } from "./lib/lobby";
import { getStreak, knownPeers, recentRooms } from "./lib/fx";

const GAMES: { id: GameId; desc: string; color: string; icon: string }[] = [
  { id: "wordle", desc: "Guess the hidden word in 6 tries.", color: "#6aaa64", icon: "🟩" },
  { id: "connections", desc: "Group words that share a common thread.", color: "#ba81c5", icon: "🧩" },
  { id: "strands", desc: "Find hidden words and uncover the theme.", color: "#aedfee", icon: "🔤" },
  { id: "crossword", desc: "A full crossword — 5, 10 or 30 minutes.", color: "#b0c4ef", icon: "✏️" },
  { id: "mini", desc: "A 5×5 crossword in a minute or two.", color: "#95befa", icon: "⬛" },
  { id: "bee", desc: "How many words can you make with 7 letters?", color: "#f7da21", icon: "🐝" },
];
const ago = (t: string | number) => { const m = Math.round((Date.now() - new Date(t).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`; };

function Home() {
  const [name, setName] = useState(getPlayer());
  const [code, setCode] = useState("");
  const lobbies = useOpenLobbies();
  const online = useSitePresence("lobby");
  const peers = new Set(knownPeers());
  const recent = recentRooms();
  const joinCode = async () => { const r = await findByCode(code.trim()); if (!r) return alert("No lobby with that code"); go(r.status === "lobby" ? `/lobby?room=${r.id}` : gameUrl({ ...r.params, room: r.id })); };
  return (
    <div className="page home">
      <div className="masthead"><h1>Game Lobby</h1><p className="muted">Daily word games. Play solo, race your friends, or solve together in real time.</p></div>
      <div className="name-row"><label>Your name <input value={name} maxLength={40} placeholder="shown to other players" onChange={(e) => { setName(e.target.value); setPlayer(e.target.value); }} /></label>
        <button className="pill ghost" onClick={() => go("/history")}>🏆 History & leaderboard</button><button className="pill ghost" onClick={() => go("/archive")}>📅 Puzzle archive</button></div>
      <div className="cards">
        {GAMES.map((g, i) => { const st = getStreak(g.id); return (
          <div key={g.id} className="card" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="card-top" style={{ background: g.color }}><span className="icon">{g.icon}</span>{st > 0 && <span className="streak">🔥 {st}</span>}</div>
            <div className="card-body"><h3>{GAME_META[g.id].name}</h3><p>{g.desc}</p>
              <div className="card-actions"><button className="play" onClick={() => go(`/${g.id}?mode=solo`)}>Play</button><button className="play ghost" onClick={() => go(`/play/${g.id}`)}>Options & friends</button></div></div>
          </div>); })}
      </div>
      <div className="lobby-cols">
        <section className="panel">
          <h2 className="section">Open lobbies <span className="live-dot" /></h2>
          {lobbies.length === 0 ? <p className="muted small">No open lobbies right now — create one from any game's “Options & friends”.</p> :
            lobbies.map((l) => (
              <div key={l.id} className="lobby-row pop-in"><Avatar name={l.host || "?"} size={30} />
                <div className="grow"><b>{l.name || `${l.host}'s lobby`}</b><div className="muted small">{GAME_META[l.game]?.name} · {optsLabel(l.params)} · {ago(l.created_at)}</div></div>
                <button className="pill" onClick={() => go(`/lobby?room=${l.id}`)}>Join</button></div>))}
          <div className="code-join"><input value={code} maxLength={4} placeholder="CODE" onChange={(e) => setCode(e.target.value.toUpperCase())} /><button className="pill ghost" disabled={code.length !== 4} onClick={joinCode}>Join private lobby</button></div>
        </section>
        <section className="panel">
          <h2 className="section">Online now ({online.length})</h2>
          {online.length === 0 ? <p className="muted small">Nobody else is here yet.</p> :
            <div className="online">{online.sort((a, b) => Number(peers.has(b.name)) - Number(peers.has(a.name))).slice(0, 30).map((o) => <span key={o.name} className="player-chip"><Avatar name={o.name} size={24} /> {o.name}{peers.has(o.name) && " ★"}</span>)}</div>}
          {recent.length > 0 && (<><h2 className="section">Rejoin</h2>
            {recent.slice(0, 5).map((r) => <div key={r.room} className="lobby-row"><div className="grow"><b>{r.name || GAME_META[r.game as GameId]?.name || r.game}</b><div className="muted small">{ago(r.at)}</div></div><button className="pill ghost" onClick={() => go(r.url)}>Rejoin</button></div>)}</>)}
        </section>
      </div>
      <footer className="muted small center">★ = people you've played with · New puzzles are generated every week — see the <a href="#/archive">archive</a>.</footer>
    </div>
  );
}

export default function App() {
  const { path, params } = useRoute();
  const k = path + params.toString();
  const page = (() => {
    if (path.startsWith("/play/")) { const g = path.slice(6) as GameId; if (GAME_META[g]) return <Setup key={k} game={g} />; }
    if (path === "/lobby" && params.get("room")) return <Lobby key={k} room={params.get("room")!} />;
    if (path === "/strands") return <StrandsPage key={k} params={params} />;
    if (path === "/wordle") return <WordlePage key={k} params={params} />;
    if (path === "/connections") return <ConnectionsPage key={k} params={params} />;
    if (path === "/crossword") return <CrosswordPage key={k} params={params} />;
    if (path === "/mini") return <CrosswordPage key={k} params={params} mini />;
    if (path === "/bee") return <BeePage key={k} params={params} />;
    if (path === "/archive") return <Archive key={k} />;
    if (path === "/history") return <History key={k} params={params} />;
    return <Home />;
  })();
  return <div className="route-fade" key={path}>{page}</div>;
}
