import { useEffect, useMemo, useRef, useState } from "react";
import { GameHeader } from "../../games/common";
import { Avatar } from "../../Lobby";
import { ensurePlayer, getPlayer, newRoomId } from "../../lib/player";
import { gameUrl } from "../../lib/lobby";
import { go } from "../../lib/router";
import { beep, confetti } from "../../lib/fx";
import { useCardTable, useAutoStart } from "../api";
import { CardRow, PlayingCard } from "../ui/PlayingCard";
import { TrainCard } from "../ui/TrainCard";
import { TrickTable, HandFan, TutorTips, cardName, type SeatInfo } from "../ui/TrickTable";
import type { Card } from "../core";
import * as Sim from "./sim";
import type { PublicSp, PrivateSp } from "./engine";
import { knownHs, type View } from "./coach";
import { coachPlay, coachBid, tipsPlay, tipsBid, bidLabel, type Coached } from "./coachView";
import "../cards.css";

const VNAME: Record<Sim.Variant, string> = { partners: "Partnership", cutthroat: "Cutthroat", draw: "Two-hand draw" };
const short = (n: string) => n.replace(" 🤖", "");

export default function SpadesPage({ params }: { params: URLSearchParams }) {
  const tutorial = params.get("tut") === "1";
  const live = params.get("mode") === "live" && !tutorial;
  const seats = Math.max(2, Math.min(4, Number(params.get("seats")) || 4));
  const bot = ["easy", "medium", "hard"].includes(params.get("bot") || "") ? params.get("bot")! : "medium";
  const train = params.get("train") === "1";
  const expect = Number(params.get("expect")) || 0;
  const [room] = useState(() => params.get("room") || newRoomId());
  const urlOpts = { game: "spades" as const, mode: (live ? "live" : "solo") as "live" | "solo", seats, bot, train: train ? 1 : undefined, tut: tutorial ? 1 : undefined };
  useEffect(() => { if (!params.get("room")) history.replaceState(null, "", "#" + gameUrl({ ...urlOpts, room })); }, [room]);
  const [name] = useState(() => ensurePlayer());
  const T = useCardTable<PublicSp, PrivateSp>(room, { game: "spades", seats, bot, name, live, tutorial },
    // private view changes on its own during the draw (a new peek card when it's your turn) — refresh on each turn there
    (p) => `${p.phase}|${p.round}|${p.handNo}|${p.phase === "draw" ? `${p.actor}|${p.stockLeft}` : ""}`);
  const { pub, priv, seat } = T;
  const [coach, setCoach] = useState<Coached | null>(null);
  const [tips, setTips] = useState<{ tier: string; text: React.ReactNode }[] | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [showSum, setShowSum] = useState(false);
  useEffect(() => () => { if (live) T.leave(); }, []);

  const view: View | null = pub ? { v: pub.v, n: pub.n, trick: pub.trick, trickSeats: pub.trickSeats, leader: pub.leader, broken: pub.broken, bids: pub.bids, nil: pub.nil, tricks: pub.tricks, counts: pub.counts, history: pub.history, bags: pub.bags, scores: pub.scores } : null;
  const hand = priv?.hand ?? null;
  const deck = useMemo(() => (pub ? Sim.deckFor(pub.v).filter((c) => !(priv?.seenDiscard ?? []).includes(c)) : []), [pub?.v, priv?.seenDiscard?.length]);
  const myTurn = !!pub && seat >= 0 && pub.actor === seat;
  const legal = useMemo(() => (myTurn && pub!.phase === "play" && hand && view ? Sim.legal(knownHs(view, seat, hand), seat) : null), [myTurn, pub?.trick.length, hand?.length]);
  const myTeam = pub && seat >= 0 ? Sim.teamOf(pub.v, seat) : 0;
  const names = pub ? pub.seats.map((s, i) => (i === seat ? "You" : short(s.name))) : [];

  // hand summary pops when a hand ends; game-over feedback
  const lastNo = useRef(-1);
  useEffect(() => { if (!pub?.lastHand) return; if (lastNo.current >= 0 && pub.lastHand.handNo !== lastNo.current) { setShowSum(true); const d = pub.lastHand.score.points[myTeam] ?? 0; beep(d >= 0 ? "good" : "bad"); } lastNo.current = pub.lastHand.handNo; }, [pub?.lastHand?.handNo]);
  const lastPhase = useRef("");
  useEffect(() => { if (!pub) return; if (pub.phase === "gameover" && lastPhase.current && lastPhase.current !== "gameover" && pub.winner?.includes(myTeam)) confetti(); lastPhase.current = pub.phase; }, [pub?.phase]);
  // lobby start: once everyone from the lobby is seated, deal
  useAutoStart(T, expect, pub);

  // tutorial: tips at every decision
  const decisionKey = pub ? `${pub.phase}|${pub.handNo}|${pub.actor}|${pub.history.length}|${pub.trick.length}|${hand?.length}` : "";
  useEffect(() => {
    setHint(null);
    if (!tutorial || !myTurn || !pub || !view || !hand || (pub.phase !== "draw" && hand.length !== pub.counts[seat])) { setTips(null); return; }
    setThinking(true);
    const t = setTimeout(() => { try {
      if (pub.phase === "bidding") { const c = coachBid(view, seat, hand, null, deck, false, 200); setTips(tipsBid(view, seat, hand, c.raw)); }
      else if (pub.phase === "play") { const c = coachPlay(view, seat, hand, null, deck, 160); setTips(tipsPlay(view, seat, hand, names, deck, c.raw)); }
      else if (pub.phase === "draw" && priv?.peek) setTips([{ tier: "Beginner", text: `Keep ${cardName(priv.peek)} or take the next (unseen) card instead — the one you don't take is out of the game.` }, { tier: "Intermediate", text: "Keep spades and aces/kings; let low cards in suits you already hold go." }, { tier: "Expert", text: `Your hand so far is worth ~${Sim.estimate(hand, pub.v).toFixed(1)} tricks; ${priv.peek[1] === "S" || "AK".includes(priv.peek[0]) ? "this card adds a likely trick — keep it." : "a random unseen card is on average about as good — take a chance on the next one."}` }]);
      } catch (e) { console.warn("tips", e); setTips(null); }
      setThinking(false);
    }, 40);
    return () => clearTimeout(t);
  }, [decisionKey, tutorial, hand?.length]);

  const runCoach = (kind: "play" | "bid", chosen: Card | { bid: number; nil: number } | null) => {
    if (!view || !hand || !pub || hand.length !== pub.counts[seat]) return; const v = view, h = hand.slice(), blind = !!priv?.blindOffer;
    setThinking(true);
    setTimeout(() => { try { setCoach(kind === "play" ? coachPlay(v, seat, h, chosen as Card | null, deck) : coachBid(v, seat, h, chosen as { bid: number; nil: number } | null, deck, blind)); } catch (e) { console.warn("coach", e); } setThinking(false); }, 30);
  };
  const playCard = (c: Card) => { beep("tap"); if (train) runCoach("play", c); else setCoach(null); T.act({ t: "play", card: c }); };
  const bid = (n: number, blind = false) => { beep("tap"); if (train && !blind) runCoach("bid", { bid: n, nil: n === 0 ? 1 : 0 }); else setCoach(null); T.act({ t: "bid", n, blind }); };
  const askHint = () => {
    if (!pub || !view || !hand || hand.length !== pub.counts[seat]) return; T.hint();
    if (pub.phase === "play") { const c = coachPlay(view, seat, hand, null, deck); setHint(c.raw[0]?.card ?? null); setCoach(c); }
    else if (pub.phase === "bidding") { const c = coachBid(view, seat, hand, null, deck, false); const b = c.raw[0]; setHint(b.nil ? "0" : String(b.bid)); setCoach(c); }
  };
  const newTable = () => go(gameUrl(urlOpts) + `&n=${Date.now()}`);

  if (!pub) return <div className="game trk"><GameHeader title="Spades" game="spades" room={live ? room : null} status="connecting" /><p className="center muted">{T.err || "Shuffling…"}</p></div>;

  const humansHere = pub.seats.filter((s) => s.kind === "human").map((s) => s.name).filter((n) => n !== getPlayer());
  const hs = Sim.handSize(pub.v);
  const teams = Array.from({ length: pub.scores.length }, (_, t) => t);
  const teamLabel = (t: number) => pub.v === "partners" ? `${names[t]} & ${names[t + 2]}` : names[t];
  const seatLine = (i: number) => {
    const b = pub.bids[i]; if (pub.phase === "waiting") return pub.seats[i].kind === "human" ? "ready" : "bot";
    if (b === null) return pub.phase === "bidding" ? (pub.actor === i ? "bidding…" : "—") : "";
    return <>{pub.nil[i] ? <b>{pub.nil[i] === 2 ? "Blind nil" : "Nil"}</b> : <>Bid <b>{b}</b></>} · took <b>{pub.tricks[i]}</b></>;
  };
  const info: SeatInfo[] = pub.seats.map((s, i) => ({ name: short(s.name), kind: s.kind, line: seatLine(i), count: pub.counts[i], cards: pub.hands?.[i] ?? null, pending: s.pending?.name ?? null, badge: <span className="tiny muted">{[pub.v === "partners" && seat >= 0 && i === (seat + 2) % 4 ? "partner" : "", s.kind === "bot" ? s.level : ""].filter(Boolean).join(" · ")}</span> }));
  const me = seat >= 0 ? pub.seats[seat] : null;
  const winTrick = pub.trick.length === 0 && pub.lastTrick && pub.phase === "play" ? `${names[pub.lastTrick.winner]} took the last trick` : "";
  const waitingOn = pub.actor >= 0 && pub.actor !== seat ? names[pub.actor] : null;
  const LH = pub.lastHand;

  return (
    <div className="game trk">
      <GameHeader title="Spades" game="spades" room={live ? room : null} status={T.err ? "offline" : "live"} peers={humansHere} />
      <div className="scorebar">{teams.map((t) => <div key={t} className={`team ${t === myTeam && seat >= 0 ? "mine" : ""}`}><span className="nm">{teamLabel(t)}</span><b>{pub.scores[t]}</b><span className="muted tiny">{pub.bags[t]} bag{pub.bags[t] === 1 ? "" : "s"}</span></div>)}
        <div className="team"><span className="nm">{VNAME[pub.v]}</span><b>{pub.target}</b><span className="muted tiny">to win · hand {pub.handNo}</span></div></div>

      <div className="felt">
        {pub.phase === "waiting" ? (
          <div className="waitbox"><p><b>Table is open.</b> {live ? "Share the link — empty seats are bots until someone sits down." : ""}</p>
            <div className="players">{pub.seats.map((s, i) => <span key={i} className="player-chip"><Avatar name={s.name} size={22} /> {short(s.name)}{s.kind === "bot" ? " (bot)" : ""}</span>)}</div>
            {me ? <button className="pill xl" disabled={T.busy} onClick={() => T.act({ t: "start" })}>Deal the first hand</button> : <p className="muted">{T.pending >= 0 ? "You'll sit in when the game starts." : "Table full — watching."}</p>}
            {expect > 0 && <p className="tiny">Auto-deals when {expect} players are seated.</p>}
          </div>
        ) : (
          <TrickTable n={pub.n} me={seat >= 0 ? seat : 0} seats={info} trick={pub.trick} trickSeats={pub.trickSeats} actor={pub.actor} deadline={pub.deadline} trickKey={`${pub.handNo}-${pub.history.length}`}
            center={pub.phase === "draw" ? `Stock: ${pub.stockLeft} cards` : pub.phase === "bidding" ? (waitingOn ? `${waitingOn} is bidding…` : "Your bid") : waitingOn && pub.phase === "play" ? `${waitingOn} to play` : winTrick} />
        )}
        {seat >= 0 && pub.phase !== "waiting" && (
          <div className="tt-me"><div className="tt-who center"><Avatar name={getPlayer()} size={22} /> <b>You</b> <span className="tiny">{seatLine(seat)}</span> <span className="stack tiny">🪙 {me?.stack.toLocaleString()}</span></div>
            {hand ? <HandFan cards={hand} legal={legal} onPick={myTurn && pub.phase === "play" ? playCard : undefined} disabled={T.busy} hinted={hint && hint.length === 2 ? hint : null} /> : priv?.blindOffer ? <div className="center"><PlayingCard card={null} /></div> : null}
          </div>)}
      </div>
      {pub.lastTrick && <div className="lasttrick muted">Last trick: <CardRow cards={pub.lastTrick.cards} small /> → {names[pub.lastTrick.winner]}</div>}
      {T.err && <p className="warn center">{T.err}</p>}

      {tutorial && myTurn && <TutorTips tips={tips} busy={thinking} sample="Tips use only what you could know at a real table; the numbers are Monte Carlo over the hidden cards." />}
      {coach && <TrainCard rows={coach.rows} chosen={coach.chosen} title={coach.chosen ? "Coach — how your move compares" : "Hint — every option, simulated"} gapText={coach.gap} sample={coach.sample} onClose={() => setCoach(null)} replay={coach.replay} />}
      {thinking && !tutorial && <p className="muted tiny center">Simulating…</p>}

      <div className="bj-controls">
        {seat < 0 && pub.phase !== "waiting" && (T.pending >= 0 ? <p className="muted center">You'll take over seat {T.pending + 1} when this hand ends.</p> : <p className="muted center">Table is full — you're watching.</p>)}
        {myTurn && pub.phase === "draw" && priv?.peek && (<div className="center">
          <p>Top of the stock:</p><div className="center" style={{ display: "flex", justifyContent: "center" }}><PlayingCard card={priv.peek} /></div>
          <div className="controls"><button className="pill" disabled={T.busy} onClick={() => T.act({ t: "keep" })}>Keep {cardName(priv.peek)}</button><button className="pill ghost" disabled={T.busy} onClick={() => T.act({ t: "discard" })}>Discard it, take the next</button></div>
        </div>)}
        {myTurn && pub.phase === "bidding" && priv?.blindOffer && !hand && (<div className="center">
          <p>You trail by 100+. Bid <b>blind nil</b> (±200) before looking at your cards?</p>
          <div className="controls"><button className="pill" disabled={T.busy} onClick={() => bid(0, true)}>Blind nil</button><button className="pill ghost" disabled={T.busy} onClick={() => T.act({ t: "look" })}>Look at my cards</button></div></div>)}
        {myTurn && pub.phase === "bidding" && hand && (<div>
          <p className="center small">How many tricks will you take? {pub.v === "partners" ? "(your bid adds to your partner's)" : ""}</p>
          <div className="bidpad">{Array.from({ length: hs + 1 }, (_, n) => <button key={n} className={`${n === 0 ? "nil" : ""} ${hint === String(n) ? "hinted" : ""}`} disabled={T.busy} onClick={() => bid(n)}>{n === 0 ? "Nil" : n}</button>)}</div>
        </div>)}
        {myTurn && (pub.phase === "play" || pub.phase === "bidding") && hand && <div className="controls"><button className="pill ghost sm" onClick={askHint}>💡 Hint</button></div>}
        {pub.phase === "gameover" && (<div className="center">
          <div className={`bj-banner ${pub.winner?.includes(myTeam) ? "good" : "bad"}`}>{pub.winner?.map(teamLabel).join(" & ")} win{pub.winner && pub.winner.length > 1 ? "" : "s"} {pub.scores.join(" – ")}</div>
          {me && <p className="small">{pub.winner?.includes(myTeam) ? `+${pub.stake}` : `−${pub.stake}`} chips</p>}
          <div className="controls">{me && <button className="pill" disabled={T.busy} onClick={() => T.act({ t: "start" })}>Rematch at this table</button>}{!live && <button className="pill ghost" onClick={newTable}>Play another</button>}</div>
        </div>)}
      </div>

      {LH && (showSum || pub.phase === "gameover") && (
        <div className="handsum pop-in"><div className="coach-h"><b>Hand {LH.handNo} result</b><button className="x" onClick={() => setShowSum(false)}>×</button></div>
          <table><thead><tr><th></th><th>Bid</th><th>Took</th><th>Points</th><th>Bags</th><th>Total</th></tr></thead>
            <tbody>{teams.map((t) => { const ss = pub.seats.map((_, i) => i).filter((i) => Sim.teamOf(pub.v, i) === t);
              return <tr key={t}><td>{teamLabel(t)}</td><td>{ss.map((i) => (LH.nil[i] ? (LH.nil[i] === 2 ? "BN" : "N") : LH.bids[i])).join("+")}</td><td>{ss.map((i) => LH.tricks[i]).join("+")}</td><td>{LH.score.points[t] >= 0 ? "+" : ""}{LH.score.points[t]}{LH.penalties[t] ? ` −${LH.penalties[t] * 100}` : ""}</td><td>{LH.score.bags[t]}</td><td><b>{LH.totals[t]}</b></td></tr>; })}</tbody></table>
          {LH.score.nilOk.some((x) => x !== null) && <p className="tiny muted">{LH.score.nilOk.map((x, i) => (x === null ? null : `${names[i]}'s nil ${x ? "made" : "failed"}`)).filter(Boolean).join(" · ")}</p>}
        </div>)}

      {!coach && train && <p className="muted small center">🎓 Train mode: after each bid and card, a coach card compares your move with the best alternatives.</p>}
      <div className="bj-foot">
        {me && <span>Bankroll <b>🪙 {me.stack.toLocaleString()}</b> · stake {pub.stake}/game</span>}
        <button className="pill ghost sm" onClick={() => go("/history?game=spades")}>🏆 Leaderboard</button>
        {!live && <button className="pill ghost sm" onClick={newTable}>Play another table</button>}
        {live && me && <button className="pill ghost sm" onClick={() => { T.leave(); go("/"); }}>Leave table</button>}
        <span className="muted tiny">Table {room} · {bot} bots{tutorial ? " · tutorial" : ""}</span>
      </div>
      <details className="bj-log"><summary className="muted small">Table log</summary>{pub.log.slice().reverse().map((e, i) => <div key={i} className="tiny muted">{e.text}</div>)}</details>
      <p className="muted tiny center">{bidLabel({ bid: 0, nil: 1 })} = take no tricks (±100) · 10 bags = −100 · <a href="https://www.pagat.com/auctionwhist/spades.html" target="_blank" rel="noreferrer">rules</a></p>
    </div>
  );
}
