import { useState } from "react";
import { useRoute, go } from "./lib/router";
import { getPlayer, setPlayer } from "./lib/player";
import StrandsPage from "./games/Strands";
import WordlePage from "./games/Wordle";
import ConnectionsPage from "./games/Connections";
import History from "./History";

const GAMES = [
  { id: "wordle", name: "Wordle", desc: "Guess the hidden word in 6 tries.", color: "#6aaa64", icon: "W" },
  { id: "connections", name: "Connections", desc: "Group words that share a common thread.", color: "#ba81c5", icon: "▦" },
  { id: "strands", name: "Mini Strands", desc: "Find hidden words and uncover the theme.", color: "#aedfee", icon: "S" },
  { id: "spelling", name: "Spelling Bee", desc: "How many words can you make with 7 letters?", color: "#f7da21", icon: "B", soon: true },
  { id: "mini", name: "The Mini", desc: "A tiny crossword in a few minutes.", color: "#95befa", icon: "M", soon: true },
];

function Home() {
  const [name, setName] = useState(getPlayer());
  return (
    <div className="page home">
      <div className="masthead"><h1>Game Lobby</h1><p className="muted">Daily word games — play solo or with a friend in real time.</p></div>
      <div className="name-row"><label>Your name <input value={name} maxLength={40} placeholder="for history & multiplayer" onChange={(e) => { setName(e.target.value); setPlayer(e.target.value); }} /></label>
        <button className="pill ghost" onClick={() => go("/history")}>History & leaderboard</button></div>
      <div className="cards">
        {GAMES.map((g) => (
          <button key={g.id} className={`card ${g.soon ? "soon" : ""}`} disabled={g.soon} onClick={() => go(`/${g.id}`)}>
            <div className="card-top" style={{ background: g.color }}><span className="icon">{g.icon}</span></div>
            <div className="card-body"><h3>{g.name}</h3><p>{g.desc}</p><span className="play">{g.soon ? "Coming soon" : "Play"}</span></div>
          </button>
        ))}
      </div>
      <footer className="muted small center">New Connections & Strands puzzles are added automatically every week.</footer>
    </div>
  );
}

export default function App() {
  const { path, params } = useRoute();
  const k = path + params.toString();
  if (path === "/strands") return <StrandsPage key={k} params={params} />;
  if (path === "/wordle") return <WordlePage key={k} params={params} />;
  if (path === "/connections") return <ConnectionsPage key={k} params={params} />;
  if (path === "/history") return <History key={k} params={params} />;
  return <Home />;
}
