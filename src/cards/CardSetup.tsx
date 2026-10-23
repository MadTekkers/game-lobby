import { useState } from "react";
import { go } from "../lib/router";
import { GAME_META, createRoom, gameUrl, type GameId, type Mode } from "../lib/lobby";
import { ensurePlayer } from "../lib/player";
import { rememberRoom } from "../lib/fx";
import "./cards.css";

type Cfg = { seats: number[]; def: number; seatLabel?: (n: number) => string; seatNote: string; bots: Record<string, string>; train: string; tutorial: string };
const CFG: Record<string, Cfg> = {
  blackjack: { seats: [2, 3, 4], def: 3, seatNote: "The dealer is always the computer. Seats without a person are played by bots.",
    bots: { easy: "Loose, makes mistakes", medium: "Mostly by the book", hard: "Sharp, no mistakes" },
    train: "after every decision, compare your move with the alternatives (win/push/lose % and EV from 20,000 simulated hands each).",
    tutorial: "Every card face-up (dealer hole card and the next card in the shoe), with beginner → expert tips and odds before each move." },
  spades: { seats: [2, 3, 4], def: 4, seatLabel: (n) => (n === 4 ? "partners" : n === 3 ? "cutthroat" : "draw"),
    seatNote: "4 = two partnerships · 3 = cutthroat, 17 cards each (2♣ removed) · 2 = two-hand draw from the stock. Game to 500; 10 bags = −100.",
    bots: { easy: "Rough bids, plays on instinct", medium: "Counts cards, avoids bags", hard: "Simulates the hidden hands" },
    train: "after every bid and card, compare your move with 1–3 alternatives (make / set % and bags from a few hundred simulated deals each).",
    tutorial: "All four hands face-up, with beginner → expert tips and Monte Carlo odds at every bid and card." },
  hearts: { seats: [2, 3, 4], def: 4, seatLabel: (n) => (n === 4 ? "classic" : n === 3 ? "2♦ out" : "stock"),
    seatNote: "4 = classic, pass left/right/across/hold · 3 = 17 cards each (2♦ removed) · 2 = 13 each plus a stock you draw from after each trick. Game ends at 100; lowest wins.",
    bots: { easy: "Passes its highest cards, plays loosely", medium: "Ducks, counts cards, flushes the queen", hard: "Simulates the hidden hands" },
    train: "after every pass and card, compare your move with 1–3 alternatives (chance of eating Q♠, expected points and moon odds from a few hundred simulated deals).",
    tutorial: "Every hand face-up, with beginner → expert tips and Monte Carlo odds at every pass and card." },
};

/** Setup screen for the card games: solo vs bots or a live table, seat count, bot level, train mode. */
export default function CardSetup({ game }: { game: GameId }) {
  const meta = GAME_META[game];
  const cfg = CFG[game] ?? CFG.blackjack;
  const [mode, setMode] = useState<Mode>("solo");
  const [tut, setTut] = useState(false);
  const [seats, setSeats] = useState(cfg.def);
  const [bot, setBot] = useState("medium");
  const [train, setTrain] = useState(false);
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const opts = { game, mode, seats, bot, train: train && !tut ? 1 : undefined, tut: tut && mode === "solo" ? 1 : undefined };
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
        <button className={`opt ${mode === "solo" && !tut ? "on" : ""}`} onClick={() => { setMode("solo"); setTut(false); }}><span className="opt-icon">🤖</span><b>Solo vs computer</b><small>You and bots at the table.</small></button>
        <button className={`opt ${tut ? "on" : ""}`} onClick={() => { setMode("solo"); setTut(true); }}><span className="opt-icon">📖</span><b>Tutorial</b><small>{cfg.tutorial}</small></button>
        <button className={`opt ${mode === "live" ? "on" : ""}`} onClick={() => { setMode("live"); setTut(false); }}><span className="opt-icon">🃏</span><b>Live table</b><small>Real people, one table — empty seats get bots, and a bot gives up its seat when someone joins.</small></button>
      </div>
      <h2 className="section">Seats at the table</h2>
      <div className="seg">{cfg.seats.map((n) => <button key={n} className={seats === n ? "on" : ""} onClick={() => setSeats(n)}>{n}<small>{cfg.seatLabel ? cfg.seatLabel(n) : mode === "solo" ? `you + ${n - 1} bot${n > 2 ? "s" : ""}` : "players"}</small></button>)}</div>
      <p className="muted small">{cfg.seatNote}</p>
      <h2 className="section">Bot level</h2>
      <div className="seg">{["easy", "medium", "hard"].map((x) => <button key={x} className={bot === x ? "on" : ""} onClick={() => setBot(x)}>{x[0].toUpperCase() + x.slice(1)}<small>{cfg.bots[x]}</small></button>)}</div>
      <h2 className="section">Coaching</h2>
      {tut ? <p className="small">Tutorial tables are just you and bots, with every card shown. Chips still move, but tutorial games don't count on the leaderboard.</p> :
      <label className="name-row"><span><input type="checkbox" checked={train} onChange={(e) => setTrain(e.target.checked)} /> <b>Train mode</b> — {cfg.train}</span></label>}
      <p className="muted small">The 💡 Hint button (the same simulation) is always available.</p>
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
