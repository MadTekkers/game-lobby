import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import * as Sim from "./sim";
import type { PublicPk, PrivatePk, Move } from "./engine";
import type { CoachSpot } from "./coach";
import { coachSpot, tips as mkTips, type Coached } from "./coachView";
import { SidePanel, type PanelTab } from "../ui/SidePanel";
import { chipStack, flyChips, dealBusyFor, type Fly } from "../ui/fly";
import { tally, showdownOdds, describeNow } from "./tally";
import { LearnCards, TERMS, contextTerm } from "./learn";
import { seededRng } from "../core";
import "../cards.css";
import "../table.css";

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
  const [tab, setTab] = useState(() => (tutorial ? "tips" : "coach"));
  // deal animations only for cards that arrive after the first render
  const live0 = useRef(false);
  useEffect(() => { if (pub) { const t = setTimeout(() => { live0.current = true; }, 50); return () => clearTimeout(t); } }, [!!pub]);
  // chips: bets slide into the pot when a betting round ends; the pot slides to the winner(s) at the end of the hand
  const prevPk = useRef<{ key: string; street: number; bets: number[]; phase: string; rects: Record<number, DOMRect> } | null>(null);
  useLayoutEffect(() => {
    if (!pub) return;
    const P = prevPk.current; const key = `${pub.handNo}`;
    const potEl = document.getElementById("pk-pot");
    if (P && (P.street !== pub.street || P.key !== key || (P.phase === "betting" && pub.phase !== "betting"))) {
      P.bets.forEach((b, i) => { if (b > 0 && P.rects[i]) flyChips(P.rects[i], potEl, b, 0); });
    }
    if (P && P.phase !== "handover" && pub.phase === "handover" && pub.lastHand) {
      const L = pub.lastHand; const wait = dealBusyFor() + 650;
      for (const pt of L.pots) for (const w of pt.winners) flyChips(potEl, document.getElementById(`pk-seat-${w}`), Math.round(pt.amount / pt.winners.length), wait);
    }
    const rects: Record<number, DOMRect> = {};
    document.querySelectorAll<HTMLElement>(".pk-betstack[data-seat]").forEach((el) => { rects[Number(el.dataset.seat)] = el.getBoundingClientRect(); });
    prevPk.current = { key, street: pub.street, bets: pub.phase === "betting" ? [...pub.bets] : [], phase: pub.phase, rects };
  });
  // tutorial: everyone's current hand + odds to showdown (only computed from cards this client legitimately has)
  const oddsKey = pub ? `${pub.handNo}|${pub.board.join("")}|${pub.folded.join("")}|${pub.phase}|${!!pub.holes}` : "";
  const tut = useMemo(() => {
    if (!pub || !pub.holes || pub.phase !== "betting") return null;
    const holes: Record<number, string[]> = {};
    pub.seats.forEach((_, i) => { const h = pub.holes![i]; if (pub.inHand[i] && !pub.folded[i] && h?.length === 2) holes[i] = h; });
    if (Object.keys(holes).length < 2) return null;
    const rows = tally(holes, pub.board); const od = showdownOdds(holes, pub.board, 2500, seededRng(pub.handNo * 31 + pub.board.length));
    return { rows, ...od };
  }, [oddsKey]);
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
  const toCall = pub.toCall; const minTo = pub.minRaiseTo;
  const word = pub.maxBet > 0 ? "Raise to" : "Bet";
  const preset = (f: number) => Math.min(maxTo, Math.max(minTo, Math.round((pub.bets[seat] ?? 0) + toCall + f * (pub.pot + toCall))));
  const k = (m: { t: string; to?: number }) => (m.t === "raise" ? `r${m.to}` : m.t);

  const n = pub.n; const vs = seat >= 0 ? seat : 0;
  const ring = (i: number, f = 1) => { const k = (i - vs + n) % n; const a = ((90 + (k * 360) / n) * Math.PI) / 180; return { x: 50 + 40 * f * Math.cos(a), y: 47.4 + 38 * f * Math.sin(a), a }; };
  const animate = live0.current;
  const order = pub.inHand.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  const dealPos = (i: number) => { const sb = pub.sbSeat >= 0 ? pub.sbSeat : (pub.button + 1) % n; const ins = order.slice().sort((a, b) => ((a - sb + n) % n) - ((b - sb + n) % n)); return { j: ins.indexOf(i), m: ins.length }; };
  const holeFly = (i: number, c: number, faceUp: boolean): Fly | null => { if (!animate) return null; const { j, m } = dealPos(i); return { from: "#pk-deck", order: c * m + Math.max(0, j), flip: faceUp, gap: 110, dur: 320 }; };
  const boardB = pub.phase === "handover" && LH ? LH.board : pub.board;
  const boardFly = (j: number): Fly | null => (!animate ? null : { from: "#pk-deck", order: 100 + j * 2 + 1, flip: true, gap: j < 3 ? 160 : 0 });
  const burns = boardB.length >= 5 ? 3 : boardB.length === 4 ? 2 : boardB.length >= 3 ? 1 : 0;
  const myBest = hole ? describeNow([...hole, ...boardB]) : "";
  const middle = Math.max(0, pub.pot - (pub.phase === "betting" ? pub.bets.reduce((a, b) => a + (b ?? 0), 0) : 0));
  const winnersTotal = LH ? LH.pots.filter((p) => !p.refund).reduce((a, p) => a + p.amount, 0) : 0;
  const hot = tutorial || train ? contextTerm({ street: pub.street, phase: pub.phase, handNo: pub.handNo, sidePots: !!LH && LH.pots.length > 1, allIn: pub.phase === "betting" && pub.seats.some((x, i) => pub.inHand[i] && !pub.folded[i] && x.chips === 0), showdown: !!LH && LH.shown.length > 1 }) : null;
  const hotTerm = TERMS.find((t) => t.id === hot);

  const seatEl = (i: number) => {
    const s = pub.seats[i]; const mine = i === seat; const p = ring(i); const inH = pub.inHand[i]; const out = !inH || pub.folded[i];
    const shown = mine ? hole : shownFor(i) ?? pub.holes?.[i] ?? null;
    const cards = inH && !(pub.folded[i] && !pub.holes && !mine) ? (shown && shown.length === 2 ? shown : [null, null]) : null;
    return (
      <div key={i} id={`pk-seat-${i}`} className={`pk-seat pks ${mine ? "pk-me" : ""} ${pub.actor === i ? "turn" : ""} ${out ? "out" : ""} ${LH && pub.phase === "handover" && LH.winners.includes(i) ? "won" : ""} ${mine && myTurn ? "myturn" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
        <div className="pk-cards">{cards ? <div className="pc-row">{cards.map((c, z) => <PlayingCard key={`${pub.handNo}-${z}`} card={c} small={!mine} fly={holeFly(i, z, !!c)} />)}</div> : <span className="tiny">{s.sitOut ? "sitting out" : inH ? "" : "—"}</span>}</div>
        {mine && myBest && <div className="pk-made" aria-live="polite">{myBest}</div>}
        <div className="pk-plate"><Avatar name={s.name} size={mine ? 22 : 18} /><b className="nm">{mine ? "You" : short(s.name)}</b><span className="stack">{s.chips.toLocaleString()}</span></div>
        <div className="pk-act tiny">{pub.phase === "handover" && LH ? (LH.net[i] ? <b className={LH.net[i] > 0 ? "good" : ""}>{LH.net[i] > 0 ? "+" : ""}{LH.net[i]}</b> : pub.folded[i] ? "Fold" : "") : pub.last[i] ?? (s.kind === "bot" && !mine ? s.level : "")}</div>
        {s.pending && <div className="tiny pend">↪ {s.pending.name}</div>}
      </div>
    );
  };
  const betEl = (i: number) => {
    const b = pub.phase === "betting" ? pub.bets[i] ?? 0 : 0; if (!b) return null; const p = ring(i, 0.6);
    return <div key={`b${i}`} className="pk-betstack" data-seat={i} style={{ left: `${p.x}%`, top: `${p.y}%` }}><span className="stk">{chipStack(b, 5).map((c, z) => <i key={z} className={`disc ${c}`} style={{ bottom: `${z * 3}px` }} />)}</span><b className="pk-bet">{b}</b></div>;
  };
  const markers = () => {
    const out: React.ReactNode[] = [];
    const mk = (i: number, label: string, cls: string, da: number) => { const a = ring(i).a + da; out.push(<span key={cls} className={`pk-mk ${cls}`} style={{ left: `${50 + 40 * 0.62 * Math.cos(a)}%`, top: `${47.4 + 38 * 0.62 * Math.sin(a)}%` }} title={label === "D" ? "Dealer button" : label === "SB" ? "Small blind" : "Big blind"}>{label}</span>); };
    if (pub.button >= 0) mk(pub.button, "D", "btn", 0.42);
    if (pub.phase === "betting" && pub.sbSeat >= 0) mk(pub.sbSeat, "SB", "sb", -0.42);
    if (pub.phase === "betting" && pub.bbSeat >= 0) mk(pub.bbSeat, "BB", "bb", -0.42);
    return out;
  };

  const table = pub.phase === "waiting" ? (
    <div className="felt pk-felt">
      <div className="waitbox"><p><b>Table is open.</b> {live ? "Share the link — empty seats are bots until someone sits down." : ""}</p>
        <div className="players">{pub.seats.map((s, i) => <span key={i} className="player-chip"><Avatar name={s.name} size={22} /> {short(s.name)}{s.kind === "bot" ? " (bot)" : ""}</span>)}</div>
        {me ? <button className="pill xl" disabled={T.busy} onClick={() => T.act({ t: "start" })}>Deal the first hand</button> : <p className="muted">{T.pending >= 0 ? "You'll sit in when the next hand starts." : "Table full — watching."}</p>}
        {expect > 0 && <p className="tiny">Auto-deals when {expect} players are seated.</p>}
      </div>
    </div>
  ) : (
    <div className={`pkt n${n}`}>
      <div className="pkt-oval" aria-hidden />
      <div className="pk-center">
        <div className="pk-dk"><span className="pk-deck" id="pk-deck" title="Deck" /><span className="tiny">Deck</span></div>
        <div className="pk-burn" title={`Burned cards: ${burns}`}><span className="burns">{Array.from({ length: burns }, (_, z) => <span key={`${pub.handNo}-${z}`} className="burnc" style={{ transform: `rotate(${z * 9 - 8}deg)` }}><PlayingCard card={null} small fly={animate ? { from: "#pk-deck", order: 100 + [0, 3, 4][z] * 2, flip: false, gap: 120, dur: 260 } : null} /></span>)}</span><span className="tiny">Burn</span></div>
        <div className="pk-board pk-cards5" aria-label="Community cards">{[0, 1, 2, 3, 4].map((j) => boardB[j] ? <PlayingCard key={`${pub.handNo}-${j}`} card={boardB[j]} i={j < 3 ? j : 0} small fly={boardFly(j)} /> : <div key={j} className="pk-slot" />)}</div>
        <div className="pk-pot" id="pk-pot">
          {middle > 0 && pub.phase === "betting" && <span className="stk" aria-hidden>{chipStack(middle, 6).map((c, z) => <i key={z} className={`disc ${c}`} style={{ bottom: `${z * 3}px` }} />)}</span>}
          {pub.phase === "handover" && LH ? <span className="pk-potl">{LH.uncontested ? `${names[LH.winners[0]]} wins` : `${LH.winners.map((w) => names[w]).join(" & ")} win${LH.winners.length > 1 ? "" : "s"}`} <b>{winnersTotal}</b>{!LH.uncontested && LH.shown.find((x) => LH.winners.includes(x.seat)) ? ` — ${LH.shown.find((x) => LH.winners.includes(x.seat))!.desc}` : ""}</span>
            : <span className="pk-potl">Pot <b>{pub.pot}</b>{pub.actor >= 0 && pub.actor !== seat ? <span className="sub"> · {names[pub.actor]} to act</span> : null}</span>}
        </div>
        <div className="pk-street tiny">{pub.phase === "betting" ? STREET[pub.street] : pub.phase === "handover" ? "Showdown / result" : ""} · blinds {pub.sb}/{pub.bb}</div>
      </div>
      {markers()}
      {pub.seats.map((_, i) => betEl(i))}
      {pub.seats.map((_, i) => seatEl(i))}
    </div>
  );

  const tallyBody = (
    <div className="tally">
      {myBest && <p className="tally-me">Your hand: <b>{myBest}</b></p>}
      {tut ? (<>
        <p className="tally-lead">If everyone stayed in, <b>{tut.rows.filter((r) => r.rank === 1).map((r) => names[r.seat]).join(" & ")}</b> {tut.rows.filter((r) => r.rank === 1).length > 1 ? "tie" : "wins"} now{tut.rows[0] ? ` (${tut.rows[0].desc})` : ""}.</p>
        <ol className="tally-list">{tut.rows.map((r) => <li key={r.seat} className={r.seat === seat ? "me" : ""}><span className="rk">#{r.rank}</span><span className="nm">{names[r.seat]}</span><span className="tiny hand">{r.desc}</span><span className="eq" title="Chance to win at showdown"><i style={{ width: `${(tut.odds[r.seat] ?? 0) * 100}%` }} />{Math.round((tut.odds[r.seat] ?? 0) * 100)}%</span></li>)}</ol>
        <p className="tiny muted">Win % = share of the pot each player takes if nobody folds, {tut.exact ? `over all ${tut.n.toLocaleString()} possible run-outs` : `from ${tut.n.toLocaleString()} simulated run-outs`} of the remaining board. Tutorial only: at a real table you'd never see these cards.</p>
      </>) : <p className="small muted">{pub.holes ? "The tally appears while a hand is being played." : "Outside the tutorial only your own hand is shown — opponents' cards stay hidden until a showdown."}</p>}
    </div>
  );
  const panel = (tutorial || train) && pub.phase !== "waiting" && (() => {
    const tabs: PanelTab[] = [];
    if (tutorial) tabs.push({ id: "tips", label: "📘 Tips", peek: hotTerm ? `${hotTerm.icon} ${hotTerm.title}: ${hotTerm.body}` : null, body: (<>
      {hotTerm && <div className="lc-now"><span className="tiny">Right now at the table</span><div className="lc open hot"><span className="lc-t">{hotTerm.icon} {hotTerm.title}</span><span className="lc-b">{hotTerm.body}</span></div></div>}
      {myTurn ? <TutorTips tips={tipsV} busy={thinking} sample="Tutorial table: every hole card is face-up. Beginner→Expert use only what you'd know at a real table (opponent ranges from their actions); Peek uses the actual hands." />
        : <p className="small">Tips for your decision appear here when it's your turn.</p>}
    </>) });
    if (tutorial) tabs.push({ id: "hands", label: "📊 Hands", peek: tut ? `If everyone stayed in, ${tut.rows.filter((r) => r.rank === 1).map((r) => names[r.seat]).join(" & ")} wins now · ${tut.rows.map((r) => `${names[r.seat]} ${Math.round((tut.odds[r.seat] ?? 0) * 100)}%`).slice(0, 3).join(", ")}` : null, body: tallyBody });
    if (train) tabs.push({ id: "coach", label: "🎓 Coach", badge: coach ? "new" : null, peek: coach?.gap ?? null, body: coach
      ? <TrainCard rows={coach.rows} chosen={coach.chosen} title={coach.chosen ? "Coach — how your move compares" : "Hint — every option, simulated"} gapText={coach.gap} sample={coach.sample} onClose={() => setCoach(null)} replay={coach.replay} />
      : <p className="small">🎓 After each action, a coach card compares it with the alternatives (equity, fold-out %, EV from Monte Carlo). {thinking ? "Simulating…" : ""}</p> });
    tabs.push({ id: "learn", label: "📚 Learn", body: <LearnCards key={hot ?? ""} hot={hot} /> });
    return <SidePanel tabs={tabs} active={tab} onTab={setTab} keepVisible=".pk-me, .pk-actions" attention={train && coach ? `${coach.chosen}-${pub.handNo}-${pub.street}-${coach.rows.length}` : null} />;
  })();

  return (
    <div className={`game pk ${panel ? "has-panel" : ""}`}>
      <GameHeader title="Texas Hold'em" game="holdem" room={live ? room : null} status={T.err ? "offline" : "live"} peers={humansHere} />
      <div className="bj-layout">
      <div className="bj-main">
      <div className="scorebar"><div className="team"><span className="nm">Blinds</span><b>{pub.sb}/{pub.bb}</b><span className="muted tiny">no limit</span></div>
        <div className="team"><span className="nm">Hand</span><b>{pub.handNo}</b><span className="muted tiny">{pub.phase === "betting" ? STREET[pub.street] : pub.phase === "handover" ? "result" : "waiting"}</span></div>
        <div className="team mine"><span className="nm">Your chips</span><b>{me ? me.chips.toLocaleString() : "—"}</b><span className="muted tiny">buy-in {pub.buyIn}</span></div></div>
      {table}
      {T.err && <p className="warn center">{T.err}</p>}
      {thinking && !tutorial && !train && <p className="muted tiny center">Simulating…</p>}

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
      {panel}
      </div>
    </div>
  );
}
