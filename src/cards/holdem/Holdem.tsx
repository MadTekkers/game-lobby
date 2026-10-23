import { useEffect, useRef, useState } from "react";
import { GameHeader } from "../../games/common";
import { Avatar } from "../../Lobby";
import { ensurePlayer, getPlayer, newRoomId } from "../../lib/player";
import { gameUrl } from "../../lib/lobby";
import { go } from "../../lib/router";
import { beep, confetti } from "../../lib/fx";
import { useCardTable, useAutoStart } from "../api";
import { CardRow, PlayingCard } from "../ui/PlayingCard";
import { TrainCard } from "../ui/TrainCard";
import { TutorTips } from "../ui/TrickTable";
import { evaluate, describe } from "./eval";
import * as Sim from "./sim";
import type { PublicPk, PrivatePk, Move } from "./engine";
import type { CoachSpot } from "./coach";
import { coachSpot, tips as mkTips, type Coached } from "./coachView";
import "../cards.css";

const short = (n: string) => n.replace(" 🤖", "");
const STREET = ["Pre-flop", "Flop", "Turn", "River"];

export default function HoldemPage({ params }: { params: URLSearchParams }) {
  const tutorial = params.get("tut") === "1";
  const live = params.get("mode") === "live" && !tutorial;
  const seats = Math.max(2, Math.min(8, Number(params.get("seats")) || 6));
  const bot = ["easy", "medium", "hard"].includes(params.get("bot") || "") ? params.get("bot")! : "medium";
  const train = params.get("train") === "1";
  const expect = Number(params.get("expect")) || 0;
  const [room] = useState(() => params.get("room") || newRoomId());
  const urlOpts = { game: "holdem" as const, mode: (live ? "live" : "solo") as "live" | "solo", seats, bot, train: train ? 1 : undefined, tut: tutorial ? 1 : undefined };
  useEffect(() => { if (!params.get("room")) history.replaceState(null, "", "#" + gameUrl({ ...urlOpts, room })); }, [room]);
  const [name] = useState(() => ensurePlayer());
  const T = useCardTable<PublicPk, PrivatePk>(room, { game: "holdem", seats, bot, name, live, tutorial }, (p) => `${p.handNo}|${p.phase === "waiting" ? "w" : ""}`);
  const { pub, priv, seat } = T;
  const [coach, setCoach] = useState<Coached | null>(null);
  const [tipsV, setTips] = useState<{ tier: string; text: React.ReactNode }[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const [amt, setAmt] = useState(0);
  const [hintKey, setHintKey] = useState<string | null>(null);
  useEffect(() => () => { if (live) T.leave(); }, []);

  const me = pub && seat >= 0 ? pub.seats[seat] : null;
  const hole = priv?.hole?.length === 2 && priv.handNo === pub?.handNo ? priv.hole : null;
  const myTurn = !!pub && seat >= 0 && pub.actor === seat && pub.phase === "betting" && !!hole;
  const names = pub ? pub.seats.map((s, i) => (i === seat ? "You" : short(s.name))) : [];
  const maxTo = pub && me ? (pub.bets[seat] ?? 0) + me.chips : 0;
  const spot = (): CoachSpot | null => {
    if (!pub || !me || !hole) return null;
    const opps = pub.seats.map((x, i) => ({ seat: i, bet: pub.bets[i] ?? 0, chips: x.chips, pfRaised: !!pub.pfRaised[i], pfCalled: !!pub.pfCalled[i], aggr: !!pub.aggr[i] }))
      .filter((o) => o.seat !== seat && pub.inHand[o.seat] && !pub.folded[o.seat]);
    return { hole, board: pub.board, pot: pub.pot, toCall: pub.toCall, myBet: pub.bets[seat] ?? 0, chips: me.chips, minRaiseTo: pub.minRaiseTo, maxBet: pub.maxBet, canRaise: pub.canRaise, bb: pub.bb, opps };
  };
  const decisionKey = pub ? `${pub.handNo}|${pub.street}|${pub.actor}|${pub.maxBet}|${pub.pot}|${!!hole}` : "";
  useEffect(() => { if (myTurn && pub) setAmt(Math.min(maxTo, Math.max(pub.minRaiseTo, Math.round((pub.bets[seat] ?? 0) + pub.toCall + (pub.pot + pub.toCall) * (pub.board.length ? 0.66 : 0) + (pub.board.length ? 0 : 2 * pub.bb))))); setHintKey(null); }, [decisionKey]);
  // tutorial: tips before every decision
  useEffect(() => {
    if (!tutorial || !myTurn || !pub) { setTips(null); return; }
    const s = spot(); if (!s) return; setThinking(true);
    const order = pub.inHand.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
    const peek = pub.holes ? s.opps.map((o) => pub.holes![o.seat]).filter((h) => h?.length === 2) : null;
    const t = setTimeout(() => { try { setTips(mkTips(s, coachSpot(s, null, 300).raw, Sim.position(order, seat, pub.button), peek)); } catch (e) { console.warn("tips", e); } setThinking(false); }, 40);
    return () => clearTimeout(t);
  }, [decisionKey, tutorial, myTurn]);

  const lastNo = useRef(-1);
  useEffect(() => { const L = pub?.lastHand; if (!L) return; if (lastNo.current >= 0 && L.handNo !== lastNo.current && seat >= 0) { const net = L.net[seat] ?? 0; if (net > 0) beep("good"); else if (net < 0) beep("bad"); if (net >= 20 * (pub?.bb ?? 10)) confetti(); } lastNo.current = L.handNo; }, [pub?.lastHand?.handNo]);
  useAutoStart(T, expect, pub);
  // solo: deal the next hand automatically after a short look at the result (unless a coach card is open)
  useEffect(() => {
    if (!pub || live || pub.phase !== "handover" || !me || me.chips < pub.bb || coach) return;
    const t = setTimeout(() => T.act({ t: "next" }), tutorial ? 6000 : 3200); return () => clearTimeout(t);
  }, [pub?.phase, pub?.handNo, !!coach]);

  const doAct = (m: Move) => {
    beep("tap"); const s = spot();
    if (train && s) { setThinking(true); setTimeout(() => { try { setCoach(coachSpot(s, m)); } catch (e) { console.warn("coach", e); } setThinking(false); }, 30); } else setCoach(null);
    T.act(m);
  };
  const askHint = () => { const s = spot(); if (!s) return; T.hint(); const c = coachSpot(s, null); setCoach(c); setHintKey(c.raw[0]?.key ?? null); };
  const newTable = () => go(gameUrl(urlOpts) + `&n=${Date.now()}`);

  if (!pub) return <div className="game pk"><GameHeader title="Texas Hold'em" game="holdem" room={live ? room : null} status="connecting" /><p className="center muted">{T.err || "Shuffling…"}</p></div>;

  const humansHere = pub.seats.filter((s) => s.kind === "human").map((s) => s.name).filter((n) => n !== getPlayer());
  const LH = pub.lastHand;
  const shownFor = (i: number) => (pub.phase === "handover" ? LH?.shown.find((x) => x.seat === i)?.hole ?? null : null);
  const others = pub.seats.map((_, i) => i).filter((i) => i !== seat).sort((a, b) => ((a - seat + pub.n) % pub.n) - ((b - seat + pub.n) % pub.n));
  const best = hole && pub.board.length >= 3 ? describe(evaluate([...hole, ...pub.board])) : hole ? (hole[0][0] === hole[1][0] ? "Pocket pair" : hole[0][1] === hole[1][1] ? "Suited" : "") : "";
  const badge = (i: number) => <>{pub.button === i && <span className="pk-btn" title="Dealer button">D</span>}{pub.phase === "betting" && pub.sbSeat === i && <span className="pk-bl">SB</span>}{pub.phase === "betting" && pub.bbSeat === i && <span className="pk-bl">BB</span>}</>;
  const toCall = pub.toCall; const minTo = pub.minRaiseTo;
  const word = pub.maxBet > 0 ? "Raise to" : "Bet";
  const preset = (f: number) => Math.min(maxTo, Math.max(minTo, Math.round((pub.bets[seat] ?? 0) + toCall + f * (pub.pot + toCall))));
  const k = (m: { t: string; to?: number }) => (m.t === "raise" ? `r${m.to}` : m.t);

  return (
    <div className="game pk">
      <GameHeader title="Texas Hold'em" game="holdem" room={live ? room : null} status={T.err ? "offline" : "live"} peers={humansHere} />
      <div className="scorebar"><div className="team"><span className="nm">Blinds</span><b>{pub.sb}/{pub.bb}</b><span className="muted tiny">no limit</span></div>
        <div className="team"><span className="nm">Hand</span><b>{pub.handNo}</b><span className="muted tiny">{pub.phase === "betting" ? STREET[pub.street] : pub.phase === "handover" ? "result" : "waiting"}</span></div>
        <div className="team mine"><span className="nm">Your chips</span><b>{me ? me.chips.toLocaleString() : "—"}</b><span className="muted tiny">buy-in {pub.buyIn}</span></div></div>

      <div className="felt pk-felt">
        {pub.phase === "waiting" ? (
          <div className="waitbox"><p><b>Table is open.</b> {live ? "Share the link — empty seats are bots until someone sits down." : ""}</p>
            <div className="players">{pub.seats.map((s, i) => <span key={i} className="player-chip"><Avatar name={s.name} size={22} /> {short(s.name)}{s.kind === "bot" ? " (bot)" : ""}</span>)}</div>
            {me ? <button className="pill xl" disabled={T.busy} onClick={() => T.act({ t: "start" })}>Deal the first hand</button> : <p className="muted">{T.pending >= 0 ? "You'll sit in when the next hand starts." : "Table full — watching."}</p>}
            {expect > 0 && <p className="tiny">Auto-deals when {expect} players are seated.</p>}
          </div>
        ) : (<>
          <div className={`pk-seats n${Math.min(others.length, 7)}`}>
            {others.map((i) => { const s = pub.seats[i]; const inH = pub.inHand[i]; const shown = shownFor(i) ?? pub.holes?.[i] ?? null; const out = !inH || pub.folded[i];
              return (<div key={i} className={`pk-seat ${pub.actor === i ? "turn" : ""} ${out ? "out" : ""} ${LH && pub.phase === "handover" && LH.winners.includes(i) ? "won" : ""}`}>
                <div className="pk-h"><Avatar name={s.name} size={20} /><b className="nm">{short(s.name)}</b>{badge(i)}</div>
                <div className="pk-cards">{inH && !(pub.folded[i] && !pub.holes) ? <CardRow cards={shown && shown.length === 2 ? shown : [null, null]} small /> : <span className="tiny muted">{s.sitOut ? "sitting out" : inH ? "" : "—"}</span>}</div>
                <div className="pk-line"><span className="stack">🪙{s.chips}</span>{(pub.bets[i] ?? 0) > 0 && pub.phase === "betting" && <span className="pk-bet">{pub.bets[i]}</span>}</div>
                <div className="pk-act tiny">{pub.phase === "handover" && LH ? (LH.net[i] ? <b className={LH.net[i] > 0 ? "good" : ""}>{LH.net[i] > 0 ? "+" : ""}{LH.net[i]}</b> : pub.folded[i] ? "Fold" : "") : pub.last[i] ?? (s.kind === "bot" ? s.level : "")}</div>
                {s.pending && <div className="tiny">↪ {s.pending.name}</div>}
              </div>); })}
          </div>
          <div className="pk-board">
            <div className="pk-cards5">{[0, 1, 2, 3, 4].map((j) => { const b = pub.phase === "handover" && LH ? LH.board : pub.board; return b[j] ? <PlayingCard key={`${pub.handNo}-${j}`} card={b[j]} i={j < 3 ? j : 0} small /> : <div key={j} className="pk-slot" />; })}</div>
            <div className="pk-pot">{pub.phase === "handover" && LH ? <>{LH.uncontested ? `${names[LH.winners[0]]} wins` : `${LH.winners.map((w) => names[w]).join(" & ")} win${LH.winners.length > 1 ? "" : "s"}`} <b>{LH.pots.filter((p) => !p.refund).reduce((a, p) => a + p.amount, 0)}</b>{!LH.uncontested && LH.shown.find((x) => LH.winners.includes(x.seat)) ? ` — ${LH.shown.find((x) => LH.winners.includes(x.seat))!.desc}` : ""}</> : <>Pot <b>{pub.pot}</b>{pub.actor >= 0 && pub.actor !== seat ? <span className="muted"> · {names[pub.actor]} to act</span> : null}</>}</div>
          </div>
          {seat >= 0 && <div className={`pk-me ${myTurn ? "turn" : ""}`}>
            <div className="pk-h"><Avatar name={getPlayer()} size={22} /><b>You</b>{badge(seat)}<span className="stack">🪙 {me?.chips.toLocaleString()}</span>{(pub.bets[seat] ?? 0) > 0 && pub.phase === "betting" && <span className="pk-bet">{pub.bets[seat]}</span>}</div>
            <div className="pk-hole">{hole ? <CardRow cards={hole} /> : <span className="muted small">{me?.sitOut ? "Sitting out" : pub.phase === "betting" ? "Not in this hand" : ""}</span>}{best && <span className="pk-made small">{best}</span>}</div>
          </div>}
        </>)}
      </div>
      {T.err && <p className="warn center">{T.err}</p>}
      {tutorial && myTurn && <TutorTips tips={tipsV} busy={thinking} sample="Tutorial table: every hole card is face-up. Beginner→Expert use only what you'd know at a real table (opponent ranges from their actions); Peek uses the actual hands." />}
      {coach && <TrainCard rows={coach.rows} chosen={coach.chosen} title={coach.chosen ? "Coach — how your move compares" : "Hint — every option, simulated"} gapText={coach.gap} sample={coach.sample} onClose={() => setCoach(null)} replay={coach.replay} />}
      {thinking && !tutorial && <p className="muted tiny center">Simulating…</p>}

      <div className="bj-controls">
        {seat < 0 && pub.phase !== "waiting" && (T.pending >= 0 ? <p className="muted center">You'll take over seat {T.pending + 1} when this hand ends.</p> : <p className="muted center">Table is full — you're watching.</p>)}
        {myTurn && (<div className="pk-actions">
          <div className="controls">
            {toCall > 0 ? <button className={`pill ghost ${hintKey === "fold" ? "hinted" : ""}`} disabled={T.busy} onClick={() => doAct({ t: "fold" })}>Fold</button> : null}
            {toCall > 0 ? <button className={`pill ${hintKey === "call" ? "hinted" : ""}`} disabled={T.busy} onClick={() => doAct({ t: "call" })}>{toCall >= (me?.chips ?? 0) ? `Call all-in ${me?.chips}` : `Call ${toCall}`}</button>
              : <button className={`pill ${hintKey === "check" ? "hinted" : ""}`} disabled={T.busy} onClick={() => doAct({ t: "check" })}>Check</button>}
            <button className="pill ghost sm" onClick={askHint}>💡 Hint</button>
          </div>
          {pub.canRaise && maxTo > pub.maxBet && (<div className="pk-raise">
            <input type="range" min={minTo} max={maxTo} step={pub.bb / 2} value={Math.min(maxTo, Math.max(minTo, amt))} onChange={(e) => setAmt(Number(e.target.value))} aria-label="Raise amount" />
            <div className="controls">
              {[["Min", minTo], ["½ pot", preset(0.5)], ["Pot", preset(1)], ["All-in", maxTo]].map(([l, v]) => <button key={l as string} className="pill ghost sm" onClick={() => setAmt(v as number)}>{l}</button>)}
              <button className={`pill ${hintKey === k({ t: "raise", to: amt }) ? "hinted" : ""}`} disabled={T.busy} onClick={() => doAct({ t: "raise", to: Math.min(maxTo, Math.max(minTo, amt)) })}>{amt >= maxTo ? `All-in ${maxTo}` : `${word} ${Math.min(maxTo, Math.max(minTo, amt))}`}</button>
            </div></div>)}
          {hintKey && <p className="tiny center">Hint: <b>{coach?.raw[0]?.label}</b> is best here.</p>}
        </div>)}
        {pub.phase === "handover" && LH && (<div className="center">
          <div className={`bj-banner ${(LH.net[seat] ?? 0) > 0 ? "good" : (LH.net[seat] ?? 0) < 0 ? "bad" : ""}`}>{seat >= 0 && LH.net[seat] ? `${LH.net[seat] > 0 ? "+" : "−"}${Math.abs(LH.net[seat])} chips` : "Hand over"}</div>
          {LH.shown.length > 0 && <div className="pk-shown">{LH.shown.map((x) => <div key={x.seat} className={`replay-line ${LH.winners.includes(x.seat) ? "won" : ""}`}><span className="small">{names[x.seat]}</span><CardRow cards={x.hole} small /><span className="tiny">{x.desc}</span></div>)}</div>}
          {LH.pots.length > 1 && <p className="tiny muted">{LH.pots.map((p, j) => `${p.refund ? "Returned" : j === 0 ? "Main pot" : `Side pot ${j}`} ${p.amount} → ${p.winners.map((w) => names[w]).join(" & ")}`).join(" · ")}</p>}
          <div className="controls">
            {me && me.chips < pub.bb ? <button className="pill" disabled={T.busy} onClick={() => T.act({ t: "rebuy" })}>Rebuy {Math.min(pub.buyIn, me.stack)}</button>
              : me && <button className="pill" disabled={T.busy} onClick={() => T.act({ t: "next" })}>Next hand</button>}
            {!live && <button className="pill ghost" onClick={newTable}>Play another</button>}
          </div>
        </div>)}
        {pub.phase === "betting" && !myTurn && seat >= 0 && <p className="center muted small">{hole ? `Waiting for ${pub.actor >= 0 ? names[pub.actor] : "the dealer"}…` : "Sit tight — you're in from the next hand."}</p>}
      </div>

      {!coach && train && <p className="muted small center">🎓 Train mode: after each action, a coach card compares it with the alternatives (equity, fold-out %, EV from Monte Carlo).</p>}
      <div className="bj-foot">
        {me && <span>Bankroll <b>🪙 {me.stack.toLocaleString()}</b> · chips settle every hand</span>}
        <button className="pill ghost sm" onClick={() => go("/history?game=holdem")}>🏆 Leaderboard</button>
        {!live && <button className="pill ghost sm" onClick={newTable}>Play another table</button>}
        {live && me && <button className="pill ghost sm" onClick={() => { T.leave(); go("/"); }}>Leave table</button>}
        <span className="muted tiny">Table {room} · {bot} bots{tutorial ? " · tutorial" : ""}</span>
      </div>
      <details className="bj-log"><summary className="muted small">Table log</summary>{pub.log.slice().reverse().map((e, i) => <div key={i} className="tiny muted">{e.text}</div>)}</details>
      <p className="muted tiny center">No-limit · blinds {pub.sb}/{pub.bb} · min raise = last raise · side pots for all-ins · <a href="https://www.pokernews.com/poker-rules/texas-holdem.htm" target="_blank" rel="noreferrer">rules</a></p>
    </div>
  );
}
