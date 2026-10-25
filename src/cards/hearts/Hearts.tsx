import { useEffect, useMemo, useRef, useState } from "react";
import { ReplayBar } from "../ui/DealSpeed";
import { GameHeader } from "../../games/common";
import { Avatar } from "../../Lobby";
import { ensurePlayer, getPlayer, newRoomId } from "../../lib/player";
import { gameUrl } from "../../lib/lobby";
import { go } from "../../lib/router";
import { beep, confetti } from "../../lib/fx";
import { useCardTable, useAutoStart } from "../api";
import { CardRow } from "../ui/PlayingCard";
import { TrainCard } from "../ui/TrainCard";
import { TrickTable, HandFan, TutorTips, cardName, type SeatInfo } from "../ui/TrickTable";
import type { Card } from "../core";
import * as Sim from "./sim";
import type { PublicHt, PrivateHt } from "./engine";
import { knownHs, type View } from "./coach";
import { coachPlay, coachPass, tipsPlay, tipsPass, type Coached } from "./coachView";
import "../cards.css";

const VNAME: Record<Sim.Variant, string> = { four: "Four-hand", three: "Three-hand (2♦ out)", two: "Two-hand (stock)" };
const short = (n: string) => n.replace(" 🤖", "");

export default function HeartsPage({ params }: { params: URLSearchParams }) {
  const tutorial = params.get("tut") === "1";
  const live = params.get("mode") === "live" && !tutorial;
  const seats = Math.max(2, Math.min(4, Number(params.get("seats")) || 4));
  const bot = ["easy", "medium", "hard"].includes(params.get("bot") || "") ? params.get("bot")! : "medium";
  const train = params.get("train") === "1";
  const expect = Number(params.get("expect")) || 0;
  const [room] = useState(() => params.get("room") || newRoomId());
  const urlOpts = { game: "hearts" as const, mode: (live ? "live" : "solo") as "live" | "solo", seats, bot, train: train ? 1 : undefined, tut: tutorial ? 1 : undefined };
  useEffect(() => { if (!params.get("room")) history.replaceState(null, "", "#" + gameUrl({ ...urlOpts, room })); }, [room]);
  const [name] = useState(() => ensurePlayer());
  const T = useCardTable<PublicHt, PrivateHt>(room, { game: "hearts", seats, bot, name, live, tutorial },
    // two-hand: each trick ends with a draw from the stock, so the private hand changes after every trick
    (p) => `${p.phase}|${p.round}|${p.handNo}|${p.v === "two" ? p.history.length : ""}`);
  const { pub, priv, seat } = T;
  const [coach, setCoach] = useState<Coached | null>(null);
  const [tips, setTips] = useState<{ tier: string; text: React.ReactNode }[] | null>(null);
  const [hint, setHint] = useState<Card[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [showSum, setShowSum] = useState(false);
  const [sel, setSel] = useState<Card[]>([]);
  useEffect(() => () => { if (live) T.leave(); }, []);

  const view: View | null = pub ? { v: pub.v, n: pub.n, trick: pub.trick, trickSeats: pub.trickSeats, leader: pub.leader, broken: pub.broken, pts: pub.pts, qs: pub.qs, counts: pub.counts, history: pub.history, stockLeft: pub.stockLeft } : null;
  const hand = priv?.hand ?? null;
  const given = priv?.passed && priv.passTo >= 0 ? { to: priv.passTo, cards: priv.passed } : null;
  const myTurn = !!pub && seat >= 0 && pub.actor === seat;
  const mustPass = !!pub && seat >= 0 && pub.phase === "pass" && !priv?.passed;
  const legal = useMemo(() => (myTurn && pub!.phase === "play" && hand && view && hand.length === pub!.counts[seat] ? Sim.legal(knownHs(view, seat, hand), seat) : null), [myTurn, pub?.trick.length, hand?.join()]);
  const names = pub ? pub.seats.map((s, i) => (i === seat ? "You" : short(s.name))) : [];
  const passToName = pub && seat >= 0 && pub.passOff ? names[(seat + pub.passOff) % pub.n] : "";
  useEffect(() => { setSel([]); }, [pub?.handNo, pub?.phase]);

  const lastNo = useRef(-1);
  useEffect(() => { if (!pub?.lastHand) return; if (lastNo.current >= 0 && pub.lastHand.handNo !== lastNo.current) { setShowSum(true); beep((pub.lastHand.points[seat] ?? 0) <= 3 ? "good" : "bad"); } lastNo.current = pub.lastHand.handNo; }, [pub?.lastHand?.handNo]);
  const lastPhase = useRef("");
  useEffect(() => { if (!pub) return; if (pub.phase === "gameover" && lastPhase.current && lastPhase.current !== "gameover" && pub.winner?.includes(seat)) confetti(); lastPhase.current = pub.phase; }, [pub?.phase]);
  useAutoStart(T, expect, pub);

  // tutorial: tips at every decision (pass and every card)
  const decisionKey = pub ? `${pub.phase}|${pub.handNo}|${pub.actor}|${pub.history.length}|${pub.trick.length}|${hand?.length}|${mustPass}` : "";
  useEffect(() => {
    setHint(null);
    if (!tutorial || !pub || !view || !hand || !(mustPass || (myTurn && pub.phase === "play" && hand.length === pub.counts[seat]))) { setTips(null); return; }
    setThinking(true);
    const t = setTimeout(() => { try {
      if (mustPass) setTips(tipsPass(hand, pub.passOff, passToName, coachPass(pub.v, pub.n, seat, hand, pub.passOff, null, 100).raw));
      else setTips(tipsPlay(view, seat, hand, names, coachPlay(view, seat, hand, null, given, 140).raw));
    } catch (e) { console.warn("tips", e); setTips(null); } setThinking(false); }, 40);
    return () => clearTimeout(t);
  }, [decisionKey, tutorial]);

  const runPlayCoach = (c: Card) => {
    if (!view || !hand || !pub || hand.length !== pub.counts[seat]) return; const v = view, h = hand.slice(), g = given;
    setThinking(true); setTimeout(() => { try { setCoach(coachPlay(v, seat, h, c, g)); } catch (e) { console.warn("coach", e); } setThinking(false); }, 30);
  };
  const playCard = (c: Card) => { beep("tap"); if (train) runPlayCoach(c); else setCoach(null); T.act({ t: "play", card: c }); };
  const toggle = (c: Card) => { beep("tap"); setSel((s) => (s.includes(c) ? s.filter((x) => x !== c) : s.length >= 3 ? [...s.slice(1), c] : [...s, c])); };
  const doPass = () => {
    if (!pub || !hand || sel.length !== 3) return; const cards = sel.slice();
    if (train) { const h = hand.slice(), v = pub.v, n = pub.n, off = pub.passOff; setThinking(true); setTimeout(() => { try { setCoach(coachPass(v, n, seat, h, off, cards)); } catch (e) { console.warn(e); } setThinking(false); }, 30); } else setCoach(null);
    T.act({ t: "pass", cards });
  };
  const askHint = () => {
    if (!pub || !view || !hand) return; T.hint();
    if (mustPass) { const c = coachPass(pub.v, pub.n, seat, hand, pub.passOff, null); setHint(c.raw[0]?.cards ?? null); setCoach(c); }
    else if (pub.phase === "play" && hand.length === pub.counts[seat]) { const c = coachPlay(view, seat, hand, null, given); setHint(c.raw[0] ? [c.raw[0].card] : null); setCoach(c); }
  };
  const newTable = () => go(gameUrl(urlOpts) + `&n=${Date.now()}`);

  if (!pub) return <div className="game trk"><GameHeader title="Hearts" game="hearts" room={live ? room : null} status="connecting" /><p className="center muted">{T.err || "Shuffling…"}</p></div>;

  const humansHere = pub.seats.filter((s) => s.kind === "human").map((s) => s.name).filter((n) => n !== getPlayer());
  const seatLine = (i: number) => {
    if (pub.phase === "waiting") return pub.seats[i].kind === "human" ? "ready" : "bot";
    if (pub.phase === "pass") return pub.passed[i] ? "passed ✓" : "choosing…";
    return <>this hand <b className={pub.pts[i] ? "hrt-pts" : ""}>{pub.pts[i]}</b>{pub.qs === i ? " · Q♠" : ""} · total <b>{pub.scores[i]}</b></>;
  };
  const info: SeatInfo[] = pub.seats.map((s, i) => ({ name: short(s.name), kind: s.kind, line: seatLine(i), count: pub.counts[i], cards: pub.hands?.[i] ?? null, pending: s.pending?.name ?? null, badge: <span className="tiny muted">{s.kind === "bot" ? s.level : ""}</span> }));
  const me = seat >= 0 ? pub.seats[seat] : null;
  const winTrick = pub.trick.length === 0 && pub.lastTrick && pub.phase === "play" ? `${names[pub.lastTrick.winner]} took the last trick${pub.lastTrick.cards.some((c) => Sim.cardPts(c)) ? ` (+${pub.lastTrick.cards.reduce((a, c) => a + Sim.cardPts(c), 0)})` : ""}` : "";
  const waitingOn = pub.actor >= 0 && pub.actor !== seat ? names[pub.actor] : null;
  const LH = pub.lastHand;
  const center = pub.phase === "pass" ? (mustPass ? `Pass 3 cards ${Sim.passName(pub.n, pub.passOff)}` : "Waiting for passes…") : waitingOn && pub.phase === "play" ? `${waitingOn} to play` : winTrick || (pub.v === "two" && pub.phase === "play" ? `Stock: ${pub.stockLeft}` : "");

  return (
    <div className="game trk">
      <GameHeader title="Hearts" game="hearts" room={live ? room : null} status={T.err ? "offline" : "live"} peers={humansHere} />
      <div className="scorebar">{pub.seats.map((_, i) => <div key={i} className={`team ${i === seat ? "mine" : ""}`}><span className="nm">{names[i]}</span><b>{pub.scores[i]}</b><span className="muted tiny">{pub.phase === "play" ? `+${pub.pts[i]}` : ""}</span></div>)}
        <div className="team"><span className="nm">{VNAME[pub.v]}</span><b>{pub.target}</b><span className="muted tiny">ends · hand {pub.handNo}</span></div></div>

      <div className="felt">
        {pub.phase === "waiting" ? (
          <div className="waitbox"><p><b>Table is open.</b> {live ? "Share the link — empty seats are bots until someone sits down." : ""}</p>
            <div className="players">{pub.seats.map((s, i) => <span key={i} className="player-chip"><Avatar name={s.name} size={22} /> {short(s.name)}{s.kind === "bot" ? " (bot)" : ""}</span>)}</div>
            {me ? <button className="pill xl" disabled={T.busy} onClick={() => T.act({ t: "start" })}>Deal the first hand</button> : <p className="muted">{T.pending >= 0 ? "You'll sit in when the game starts." : "Table full — watching."}</p>}
            {expect > 0 && <p className="tiny">Auto-deals when {expect} players are seated.</p>}
          </div>
        ) : (
          <TrickTable n={pub.n} me={seat >= 0 ? seat : 0} seats={info} trick={pub.trick} trickSeats={pub.trickSeats} actor={pub.actor} deadline={pub.deadline} trickKey={`${pub.handNo}-${pub.history.length}`} lastWinner={pub.lastTrick?.winner ?? null} center={center} />
        )}
        {seat >= 0 && pub.phase !== "waiting" && (
          <div className="tt-me hm-me"><div className="tt-who center"><Avatar name={getPlayer()} size={22} /> <b>You</b> <span className="tiny">{seatLine(seat)}</span> <span className="stack tiny">🪙 {me?.stack.toLocaleString()}</span></div>
            {hand && <HandFan cards={hand} legal={mustPass ? null : legal} onPick={mustPass ? toggle : myTurn && pub.phase === "play" ? playCard : undefined} disabled={T.busy} hinted={hint} selected={mustPass ? sel : undefined} marked={pub.phase === "play" && pub.history.length === 0 ? priv?.received : undefined} />}
          </div>)}
      </div>
      {pub.phase === "play" && pub.history.length === 0 && !!priv?.received?.length && <p className="center tiny muted">Received from {names[(seat - pub.passOff + pub.n) % pub.n]}: <CardRow cards={priv.received} small /> {priv.passed && <>· you passed <CardRow cards={priv.passed} small /></>}</p>}
      <ReplayBar replaying={T.replaying} skip={T.skip} />
      {pub.lastTrick && <div className="lasttrick muted">Last trick: <CardRow cards={pub.lastTrick.cards} small /> → {names[pub.lastTrick.winner]}</div>}
      {T.err && <p className="warn center">{T.err}</p>}

      {tutorial && (myTurn || mustPass) && <TutorTips tips={tips} busy={thinking} sample="Tips use only what you could know at a real table; the numbers are Monte Carlo over the hidden cards." />}
      {coach && <TrainCard rows={coach.rows} chosen={coach.chosen} title={coach.chosen ? "Coach — how your move compares" : "Hint — every option, simulated"} gapText={coach.gap} sample={coach.sample} onClose={() => setCoach(null)} replay={coach.replay} />}
      {thinking && !tutorial && <p className="muted tiny center">Simulating…</p>}

      <div className="bj-controls">
        {seat < 0 && pub.phase !== "waiting" && (T.pending >= 0 ? <p className="muted center">You'll take over seat {T.pending + 1} when this hand ends.</p> : <p className="muted center">Table is full — you're watching.</p>)}
        {mustPass && <div className="hrt-pass"><p className="small">Pick 3 cards to pass to <b>{passToName}</b> ({sel.length}/3): {sel.map(cardName).join(" ")}</p>
          <button className="pill" disabled={T.busy || sel.length !== 3} onClick={doPass}>Pass {Sim.passName(pub.n, pub.passOff)}</button></div>}
        {pub.phase === "pass" && seat >= 0 && !mustPass && <p className="center muted small">You passed {priv?.passed?.map(cardName).join(" ")} — waiting for the others.</p>}
        {(mustPass || (myTurn && pub.phase === "play")) && hand && <div className="controls"><button className="pill ghost sm" disabled={T.busy} onClick={askHint}>💡 Hint</button></div>}
        {pub.phase === "gameover" && (<div className="center">
          <div className={`bj-banner ${pub.winner?.includes(seat) ? "good" : "bad"}`}>{pub.winner?.map((i) => names[i]).join(" & ")} win{pub.winner && pub.winner.length > 1 ? "" : "s"} — {pub.scores.map((x, i) => `${names[i]} ${x}`).join(" · ")}</div>
          {me && <p className="small">{pub.winner?.includes(seat) ? `+${pub.stake}` : `−${pub.stake}`} chips</p>}
          <div className="controls">{me && <button className="pill" disabled={T.busy} onClick={() => T.act({ t: "start" })}>Rematch at this table</button>}{!live && <button className="pill ghost" onClick={newTable}>Play another</button>}</div>
        </div>)}
      </div>

      {LH && (showSum || pub.phase === "gameover") && (
        <div className="handsum pop-in"><div className="coach-h"><b>Hand {LH.handNo} result</b><button className="x" onClick={() => setShowSum(false)}>×</button></div>
          <table><thead><tr><th></th><th>Taken</th><th>Points</th><th>Total</th></tr></thead>
            <tbody>{pub.seats.map((_, i) => <tr key={i}><td>{names[i]}</td><td>{LH.raw[i]}{LH.qs === i ? " (Q♠)" : ""}</td><td>{LH.points[i]}</td><td><b>{LH.totals[i]}</b></td></tr>)}</tbody></table>
          {LH.moon >= 0 && <p className="tiny">🌙 {names[LH.moon]} shot the moon — everyone else +26.</p>}
        </div>)}

      {!coach && train && <p className="muted small center">🎓 Train mode: after each pass and card, a coach card compares your move with the best alternatives.</p>}
      <div className="bj-foot">
        {me && <span>Bankroll <b>🪙 {me.stack.toLocaleString()}</b> · stake {pub.stake}/game</span>}
        <button className="pill ghost sm" onClick={() => go("/history?game=hearts")}>🏆 Leaderboard</button>
        {!live && <button className="pill ghost sm" onClick={newTable}>Play another table</button>}
        {live && me && <button className="pill ghost sm" onClick={() => { T.leave(); go("/"); }}>Leave table</button>}
        <span className="muted tiny">Table {room} · {bot} bots{tutorial ? " · tutorial" : ""}</span>
      </div>
      <details className="bj-log"><summary className="muted small">Table log</summary>{pub.log.slice().reverse().map((e, i) => <div key={i} className="tiny muted">{e.text}</div>)}</details>
      <p className="muted tiny center">♥ = 1 · Q♠ = 13 · all 26 = shoot the moon · lowest score at {pub.target} wins · <a href="https://www.pagat.com/reverse/hearts.html" target="_blank" rel="noreferrer">rules</a></p>
    </div>
  );
}
