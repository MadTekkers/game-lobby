import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GameHeader } from "../../games/common";
import { Avatar } from "../../Lobby";
import { ensurePlayer, getPlayer, newRoomId } from "../../lib/player";
import { gameUrl } from "../../lib/lobby";
import { go } from "../../lib/router";
import { beep, confetti } from "../../lib/fx";
import { useCardTable } from "../api";
import { PlayingCard } from "../ui/PlayingCard";
import { SidePanel, type PanelTab } from "../ui/SidePanel";
import { chipStack, flyChips, dealBusyFor, type Fly } from "../ui/fly";
import { CountPanel, RulesQuiz } from "./trainer";
import { TrainCard } from "../ui/TrainCard";
import { TutorTips } from "../ui/TrickTable";
import { bjTips } from "./tutor";
import { handValue, basicStrategy, sameValue, ACTION_LABEL, type Action } from "./strategy";
import type { PublicBJ } from "./engine";
import { runCoach, Replay, type CoachResult } from "./coach";
import "../cards.css";
import "../table.css";

type PSeat = PublicBJ["seats"][number];
const fmt = (n: number) => n.toLocaleString();
const totalText = (cards: (string | null)[]) => {
  const known = cards.filter(Boolean) as string[]; if (!known.length) return "";
  const v = handValue(known); if (cards.includes(null)) return `${v.total}`;
  return v.total > 21 ? "Bust" : known.length === 2 && v.total === 21 ? "BJ" : v.soft && v.total < 21 ? `${v.total - 10}/${v.total}` : `${v.total}`;
};
/** Seat spots along the table's curved edge (first base — seat 1 — on the dealer's left, i.e. the right of the screen). */
const ANGLES: Record<number, number[]> = { 1: [90], 2: [60, 120], 3: [38, 90, 142], 4: [28, 69, 111, 152] };
const spot = (i: number, n: number) => { const a = ((ANGLES[n] ?? ANGLES[4])[i] * Math.PI) / 180; return { x: 50 + 40 * Math.cos(a), y: 36 + 54 * Math.sin(a) }; };
const RESULT: Record<string, string> = { blackjack: "Blackjack!", win: "Win", push: "Push", lose: "Lose", bust: "Bust" };

export default function BlackjackPage({ params }: { params: URLSearchParams }) {
  const tutorial = params.get("tut") === "1";
  const live = params.get("mode") === "live" && !tutorial;
  const seats = Math.max(2, Math.min(4, Number(params.get("seats")) || 3));
  const bot = ["easy", "medium", "hard"].includes(params.get("bot") || "") ? params.get("bot")! : "medium";
  const train = params.get("train") === "1";
  const [room] = useState(() => params.get("room") || newRoomId());
  useEffect(() => { if (!params.get("room")) history.replaceState(null, "", "#" + gameUrl({ game: "blackjack", mode: live ? "live" : "solo", seats, bot, train: train ? 1 : undefined, tut: tutorial ? 1 : undefined, room })); }, [room]);
  const [name] = useState(() => ensurePlayer());
  const T = useCardTable<PublicBJ>(room, { game: "blackjack", seats, bot, name, live, tutorial });
  const { pub, seat } = T;
  const me: PSeat | null = pub && seat >= 0 ? pub.seats[seat] : null;
  const [bet, setBet] = useState(() => Number(localStorage.getItem("bj_bet")) || 25);
  useEffect(() => { if (me && bet > me.stack) setBet(Math.max(0, Math.min(me.stack, 500))); }, [me?.stack]);
  const [coach, setCoach] = useState<CoachResult | null>(null);
  const [hintOn, setHintOn] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  useEffect(() => () => { if (live) T.leave(); }, []);
  const [tips, setTips] = useState<{ tier: string; text: string }[] | null>(null);
  const [showShoe, setShowShoe] = useState(() => localStorage.getItem("bj_show_shoe") !== "0");
  useEffect(() => localStorage.setItem("bj_show_shoe", showShoe ? "1" : "0"), [showShoe]);
  const [tab, setTab] = useState(() => (tutorial ? "tips" : "coach"));
  // deal animations only for cards that arrive after the first render (a reload shouldn't re-deal the table)
  const live0 = useRef(false);
  useEffect(() => { if (pub) { const t = setTimeout(() => { live0.current = true; }, 50); return () => clearTimeout(t); } }, [!!pub]);
  // chips: losers' bets slide to the dealer's rack, winners get paid from it
  const prevRound = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!pub) return;
    if (pub.phase === "betting" && pub.results.length && prevRound.current !== null && prevRound.current !== pub.round) {
      const rack = document.getElementById("bj-rack"); const wait = dealBusyFor() + 250;
      for (const r of pub.results) { const c = document.getElementById(`bj-c${r.seat}`); if (r.net > 0) flyChips(rack, c, r.net, wait); else if (r.net < 0) flyChips(c, rack, -r.net, wait); }
    }
    prevRound.current = pub.round;
  }, [pub?.round, pub?.phase]);

  // result feedback once per settled round
  const lastRound = useRef(0);
  useEffect(() => {
    if (!pub || pub.phase !== "betting" || !pub.results.length || pub.round === lastRound.current) return;
    const first = lastRound.current === 0; lastRound.current = pub.round; if (first) return;
    const r = pub.results.find((x) => x.seat === seat);
    if (r) { if (r.hands.some((h) => h.result === "blackjack")) confetti(); else beep(r.net > 0 ? "good" : r.net < 0 ? "bad" : "tap"); }
  }, [pub?.round, pub?.phase]);

  const myTurn = !!pub && pub.phase === "play" && pub.turn?.seat === seat;
  const hand = myTurn && me ? me.hands[pub!.turn!.hand] : null;
  const legal = useMemo<Action[]>(() => {
    if (!hand || !me) return [];
    const l: Action[] = ["hit", "stand"];
    if (hand.cards.length === 2 && me.stack >= hand.bet) { l.push("double"); if (sameValue(hand.cards[0], hand.cards[1]) && me.hands.length < 3) l.push("split"); }
    return l;
  }, [hand, me]);
  const seen = pub ? [...pub.seats.flatMap((s) => s.hands.flatMap((h) => h.cards)), ...pub.dealer] : [];
  const insuranceNow = !!pub && pub.phase === "insurance" && !!me?.inRound && me.insurance === null;
  const coachInput = () => insuranceNow
    ? { cards: me!.hands[0].cards, dealerUp: pub!.dealer[0]!, seen, legal: [] as Action[], insurancePhase: true }
    : { cards: hand!.cards, dealerUp: pub!.dealer[0]!, seen, legal, handsSoFar: me!.hands.length };
  const coachAfter = (chosen: string | null) => { const inp = coachInput(); setTimeout(() => setCoach(runCoach(inp, chosen)), 30); };

  const tipKey = pub ? `${pub.round}|${pub.phase}|${myTurn ? hand?.cards.length : "-"}|${pub.turn?.hand}|${insuranceNow}` : "";
  useEffect(() => {
    if (!tutorial || !pub || !(myTurn || insuranceNow) || !me) { setTips(null); return; }
    const t = setTimeout(() => {
      const inp = coachInput(); const c = runCoach(inp, null, 8000);
      const cards = insuranceNow ? me.hands[0].cards : hand!.cards;
      const b = insuranceNow ? null : basicStrategy(cards, pub.dealer[0]!, legal.includes("double"), legal.includes("split"));
      setTips(bjTips({ cards, up: pub.dealer[0]!, hole: pub.holeHidden ? pub.tutDealer?.[1] ?? null : null, next: showShoe ? pub.next ?? [] : [], basic: b, coach: c, insurance: insuranceNow }));
    }, 40);
    return () => clearTimeout(t);
  }, [tipKey, tutorial, showShoe]);

  const play = (a: Action) => { beep("tap"); setHintOn(false); if (train) coachAfter(a); else setCoach(null); T.act({ t: a }); };
  const insure = (take: boolean) => { if (train) coachAfter(take ? "insure" : "noinsure"); T.act({ t: "insurance", take }); };
  const askHint = () => { setHintOn(true); T.hint(); coachAfter(null); };
  const placeBet = () => { const a = Math.max(pub!.minBet, Math.min(bet, pub!.maxBet, me!.stack)); localStorage.setItem("bj_bet", String(a)); setCoach(null); T.act({ t: "bet", amount: a }); };
  const newTable = () => go(gameUrl({ game: "blackjack", mode: live ? "live" : "solo", seats, bot, train: train ? 1 : undefined, tut: tutorial ? 1 : undefined }) + `&n=${Date.now()}`);

  // the "below" action bar follows the active hand (e.g. after a split): centre it on that hand's cards
  useLayoutEffect(() => {
    const bar = document.querySelector<HTMLElement>(".bjt .bj-acts.below"); if (!bar || !pub || seat < 0) return;
    const k = myTurn ? pub.turn!.hand : 0;
    const h = document.getElementById(`bj-s${seat}-h${k}`) ?? document.querySelector<HTMLElement>(".bj-seat.mine"); const t = bar.parentElement;
    if (!h || !t) return; const hr = h.getBoundingClientRect(), tr = t.getBoundingClientRect();
    bar.style.setProperty("--x", `${Math.round(hr.left + hr.width / 2 - tr.left)}px`);
  });
  if (!pub) return <div className="game bj"><GameHeader title="Blackjack" game="blackjack" room={live ? room : null} status="connecting" /><p className="center muted">{T.err || "Shuffling a fresh 6-deck shoe…"}</p></div>;

  const dealKey = pub.phase === "betting" ? pub.round - 1 : pub.round;
  const humansHere = pub.seats.filter((s) => s.kind === "human").map((s) => s.name).filter((n) => n !== getPlayer());
  const waitingOn = pub.phase === "play" && pub.turn ? pub.seats[pub.turn.seat] : null;
  const secsLeft = pub.deadline ? Math.max(0, Math.ceil((pub.deadline - now) / 1000)) : null;
  const myResult = pub.phase === "betting" ? pub.results.find((r) => r.seat === seat) : undefined;
  const dealerTotal = totalText(pub.dealer);
  const shownDealer = pub.tutorial && pub.tutDealer ? pub.tutDealer : pub.dealer;
  const basic = hand && pub.dealer[0] ? basicStrategy(hand.cards, pub.dealer[0], legal.includes("double"), legal.includes("split")) : null;

  const n = pub.seats.length;
  const inRound = pub.seats.map((s, i) => (s.inRound ? i : -1)).filter((i) => i >= 0);
  const animate = live0.current;
  /** deal order: two passes round the table (seat 1 first), dealer last in each pass; then hits seat by seat; the dealer draws last */
  const flyFor = (i: number, k: number, c: number, faceUp: boolean): Fly | null => {
    if (!animate) return null;
    const j = inRound.indexOf(i), m = inRound.length;
    const s = pub.seats[i]; const split = s.hands.length > 1;
    if (k > 0 && c === 0) return { from: `#bj-s${i}-h${k - 1}`, order: 200 + i * 40 + k * 8, flip: false, gap: 60 };
    if (c < 2 && !split && j >= 0) return { from: "#bj-shoe", order: c * (m + 1) + j, flip: faceUp };
    return { from: "#bj-shoe", order: 200 + i * 40 + k * 8 + c, flip: faceUp };
  };
  const dealerFly = (c: number, faceUp: boolean): Fly | null => !animate ? null : { from: "#bj-shoe", order: c < 2 ? c * (inRound.length + 1) + inRound.length : 1000 + c, flip: faceUp };
  const shoePct = Math.round((pub.shoeLeft / pub.shoeSize) * 100);
  const used = pub.shoeSize - pub.shoeLeft;
  const myHandCards = myTurn && hand ? hand.cards : insuranceNow && me ? me.hands[0].cards : null;
  const activeHandIdx = myTurn ? pub.turn!.hand : 0;

  const seatEl = (s: PSeat, i: number) => {
    const mine = i === seat; const p = spot(i, n);
    const circleAmt = s.hands.length ? s.hands.reduce((a, h) => a + h.bet, 0) : mine && pub.phase === "betting" && !s.decided ? Math.min(bet, s.stack) : s.bet;
    return (
      <div key={i} className={`bj-seat bjs ${mine ? "mine" : ""} ${pub.turn?.seat === i ? "turn" : ""} ${s.kind} ${s.hands.length === 0 ? "idle" : ""}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
        <div className="bj-hands">
          {s.hands.length === 0 ? <div className="bj-empty">{pub.phase === "betting" ? (s.decided ? (s.bet ? "" : "Sitting out") : s.kind === "human" ? (mine ? "" : "Betting…") : "") : ""}</div> :
            s.hands.map((h, k) => (
              <div key={`${dealKey}-${k}`} id={`bj-s${i}-h${k}`} className={`bj-hand ${pub.turn?.seat === i && pub.turn.hand === k ? "active" : ""}`}>
                {mine && k === activeHandIdx && actsSide}
                <div className="pc-row">{h.cards.map((c, ci) => <PlayingCard key={`${c}-${ci}`} card={c} small={!mine} fly={flyFor(i, k, ci, true)} rot={h.doubled && ci === 2} />)}</div>
                <div className="bj-hand-f"><span className="tot">{totalText(h.cards)}</span>{s.hands.length > 1 && <span className="chip">{h.bet}{h.doubled ? "×2" : ""}</span>}{h.result && <span className={`res ${h.result}`}>{RESULT[h.result]}</span>}</div>
              </div>))}
        </div>
        <div className={`bj-circle ${circleAmt ? "has" : ""}`} id={`bj-c${i}`} title={circleAmt ? `Bet ${circleAmt}` : "Betting circle"}>
          <span className="stackc" aria-hidden>{chipStack(circleAmt, 6).map((c, z) => <i key={z} className={`disc ${c}`} style={{ bottom: `${z * 3}px` }} />)}</span>
          {circleAmt > 0 && <b className="amt">{fmt(circleAmt)}{s.hands.some((h) => h.doubled) ? " ×2" : ""}</b>}
          {(s.insurance ?? 0) > 0 && <span className="ins" title="Insurance">INS {s.insurance}</span>}
        </div>
        <div className="bj-plate"><Avatar name={s.name} size={mine ? 22 : 18} /><b className="nm">{mine ? "You" : s.name}</b><span className="stack">{fmt(s.stack)}</span></div>
        {s.pending && <div className="tiny pend">↪ {s.pending.name} next hand</div>}
        {pub.turn?.seat === i && secsLeft !== null && <div className="clock"><i style={{ width: `${Math.min(100, (secsLeft / 30) * 100)}%` }} /></div>}
      </div>
    );
  };
  const myP = seat >= 0 ? spot(seat, n) : null;
  // actions go right under my hand when I'm on the low middle of the arc; on the higher wings they sit beside my cards, on the felt side
  const lowest = Math.max(...pub.seats.map((_, i) => spot(i, n).y));
  const beside = !!myP && myP.y < lowest - 3;
  const actsInner = (myTurn || insuranceNow) && me && (insuranceNow ? (<>
        <span className="bj-acts-l">Insurance {Math.floor(me.bet / 2)}?</span>
        <button className="pill act ins" disabled={T.busy} onClick={() => insure(true)}>Take insurance</button>
        <button className="pill act no" disabled={T.busy} onClick={() => insure(false)}>No thanks</button>
      </>) : (<>
        {(["hit", "stand", "double", "split"] as Action[]).filter((a) => legal.includes(a) || a === "hit" || a === "stand").map((a) => <button key={a} className={`pill act ${a} ${hintOn && basic === a ? "hinted" : ""}`} disabled={T.busy || !legal.includes(a)} onClick={() => play(a)}>{ACTION_LABEL[a]}</button>)}
        <button className="pill act hint" onClick={askHint} aria-label="Hint" title="Hint">💡</button>
        {hintOn && basic && <span className="bj-acts-l">Basic strategy: <b>{ACTION_LABEL[basic]}</b>{secsLeft !== null && ` · ${secsLeft}s`}</span>}
      </>));
  const acts = myP && actsInner && !beside && (
    <div className={`bj-acts below ${insuranceNow ? "ins" : ""}`} style={{ ["--x" as string]: `${myP.x}%`, top: `calc(${myP.y}% + 6px)` }} role="group" aria-label="Your move">{actsInner}</div>
  );
  const actsSide = myP && actsInner && beside && (
    <div className={`bj-acts side ${myP.x > 50 ? "left" : "right"} ${insuranceNow ? "ins" : ""}`} role="group" aria-label="Your move">{actsInner}</div>
  );

  const table = (
    <div className={`bjt n${n} ${actsInner ? "acting" : ""}`} data-felt="30,109,68">
      <div className="bjt-felt" aria-hidden />
      <div className="bj-rack" id="bj-rack" aria-hidden>{["c500", "c100", "c25", "c10", "c5", "c100", "c25", "c500"].map((c, z) => <i key={z} className={`col ${c}`} />)}</div>
      <div className="bj-discard" aria-label={`Discard tray: ${used} cards`} title="Discard tray"><span className="tray"><i style={{ height: `${Math.min(100, (used / pub.shoeSize) * 100 * 1.4)}%` }} /></span><span className="tiny lbl">Discards</span></div>
      <div className="bj-shoe" title="Cards left in the shoe">
        <span className="shoe-box" id="bj-shoe"><span className="shoe-card" /></span>
        <span className="tiny lbl">{pub.reshuffled ? "New shoe" : `Shoe ${shoePct}%`}</span>
        {pub.tutorial && <button className="shoe-tg" aria-pressed={showShoe} onClick={() => setShowShoe(!showShoe)}>{showShoe ? "Hide shoe" : "Show shoe"}</button>}
        {pub.tutorial && showShoe && pub.next && <div className="tut-next" aria-label="Next cards in the shoe">{pub.next.map((c, z) => <PlayingCard key={`${c}${z}`} card={c} small />)}</div>}
      </div>
      <div className="bj-dealer">
        <div className="bj-label">Dealer</div>
        <div key={dealKey} className="bj-dealer-cards">{pub.dealer.length ? <div className="pc-row">{shownDealer.map((c, z) => <PlayingCard key={pub.tutorial ? `${c}-${z}` : z} card={c} fly={dealerFly(z, z !== 1 || !pub.holeHidden || !!pub.tutorial)} />)}</div> : <div className="bj-empty">Place your bets</div>}</div>
        {dealerTotal && <div className="tot big">{pub.tutorial && pub.holeHidden && pub.tutDealer?.length ? `${dealerTotal} (+ hole ${totalText(pub.tutDealer)})` : dealerTotal}</div>}
      </div>
      <svg className="bj-print" viewBox="0 0 1000 270" aria-label="Blackjack pays 3 to 2. Dealer must stand on all 17s. Insurance pays 2 to 1." role="img">
        <defs>
          <path id="bjp1" d="M 60 20 Q 500 250 940 20" /><path id="bjp2" d="M 150 70 Q 500 300 850 70" /><path id="bjp3" d="M 260 125 Q 500 325 740 125" />
        </defs>
        <path d="M 200 100 Q 500 294 800 100" className="band" /><path d="M 270 140 Q 500 330 730 140" className="band" />
        <text className="p1"><textPath href="#bjp1" startOffset="50%" textAnchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
        <text className="p2"><textPath href="#bjp2" startOffset="50%" textAnchor="middle">Dealer must stand on all 17s</textPath></text>
        <text className="p3"><textPath href="#bjp3" startOffset="50%" textAnchor="middle">INSURANCE PAYS 2 TO 1</textPath></text>
      </svg>
      {pub.seats.map((s, i) => seatEl(s, i))}
      {acts}
      {myResult && <div className={`bj-banner ${myResult.net > 0 ? "good" : myResult.net < 0 ? "bad" : ""}`}>{myResult.net > 0 ? `+${fmt(myResult.net)} chips` : myResult.net < 0 ? `−${fmt(-myResult.net)} chips` : "Push — bet returned"}</div>}
    </div>
  );

  const panel = (tutorial || train) && (() => {
    const tabs: PanelTab[] = [];
    if (tutorial) tabs.push({ id: "tips", label: "📘 Tips", peek: tips?.[0]?.text ?? null, body: (<>
      {tips && (myTurn || insuranceNow) ? <TutorTips tips={tips} busy={false} sample={`Odds come from the Monte Carlo coach using only the cards a real player sees; the Peek line uses the face-up cards${showShoe ? "" : " (shoe hidden)"}.`} />
        : <div className="tutor"><div className="tutor-h">📘 Tutorial</div><p className="small">Tips appear here when it's your turn. The dealer's hole card is shown face up{showShoe ? " and the next cards in the shoe are on the table" : ""} so you can see what would have happened.</p></div>}
      <label className="switch"><input type="checkbox" checked={showShoe} onChange={(e) => setShowShoe(e.target.checked)} /> Show the upcoming cards in the shoe</label>
    </>) });
    if (train) tabs.push({ id: "coach", label: "🎓 Coach", badge: coach ? "new" : null, peek: coach?.gap ?? null, body: coach
      ? <TrainCard rows={coach.rows} chosen={coach.chosen} title={coach.chosen ? "Coach — how your move compares" : "Hint — every option, simulated"} gapText={coach.gap}
          sample={`Probabilities from ${coach.n.toLocaleString()} Monte Carlo hands per option.`} onClose={() => setCoach(null)} replay={(k) => <Replay input={coach.input} action={k} />} />
      : <p className="small">🎓 After each decision, the coach compares your move with every alternative (win %, EV) using Monte Carlo simulation. Tap 💡 for a hint before you act.</p> });
    tabs.push({ id: "count", label: "🧮 Count", body: <CountPanel pub={pub} myCards={myHandCards} up={pub.dealer[0] ?? null} insurance={insuranceNow} minBet={pub.minBet} /> });
    if (tutorial) tabs.push({ id: "rules", label: "📋 Rules", body: <RulesQuiz /> });
    return <SidePanel tabs={tabs} active={tab} onTab={setTab} keepVisible=".bj-seat.mine, .bj-acts" attention={train && coach ? `${coach.chosen}-${coach.n}-${pub.round}-${activeHandIdx}` : null} />;
  })();

  return (
    <div className={`game bj ${panel ? "has-panel" : ""}`}>
      <GameHeader title="Blackjack" game="blackjack" room={live ? room : null} status={T.err ? "offline" : "live"} peers={humansHere} />
      <div className="bj-layout">
        <div className="bj-main">
          {table}
          {T.err && <p className="warn center">{T.err}</p>}
          <div className="bj-controls">
            {!me && (T.pending >= 0 ? <p className="muted center">You'll take over seat {T.pending + 1} when this hand ends.</p> : <p className="muted center">Table is full — you're watching. A seat opens when a bot's spot frees up.</p>)}
            {me && pub.phase === "betting" && !me.decided && (
              <div className="bet-box">
                <div className="bet-amt"><span className="muted small">Bet</span> <b>{fmt(Math.min(bet, me.stack))}</b></div>
                <div className="chips">{[10, 25, 100, 500].map((c) => <button key={c} className={`chipbtn c${c}`} onClick={() => { beep("tap"); setBet((b) => Math.min(pub.maxBet, me.stack, b + c)); }}>{c}</button>)}
                  <button className="pill ghost sm" onClick={() => setBet(0)}>Clear</button></div>
                <div className="controls"><button className="pill xl" disabled={T.busy || Math.min(bet, me.stack) < pub.minBet} onClick={placeBet}>Deal</button><button className="pill ghost" disabled={T.busy} onClick={() => T.act({ t: "sitout" })}>Sit out</button></div>
              </div>)}
            {me && pub.phase === "betting" && me.decided && <p className="muted center">Waiting for the other players to bet<span className="dots" />{secsLeft !== null && ` (${secsLeft}s)`}</p>}
            {insuranceNow && <p className="muted center">Dealer shows an ace — decide on insurance next to your hand.</p>}
            {pub.phase === "insurance" && !insuranceNow && <p className="muted center">Others are deciding on insurance<span className="dots" /></p>}
            {myTurn && <p className="muted center small">Your move — the buttons are next to your hand.{secsLeft !== null && ` ${secsLeft}s`}</p>}
            {pub.phase === "play" && !myTurn && waitingOn && <p className="muted center">{waitingOn.kind === "bot" ? "Bots are playing" : `${waitingOn.name} is deciding`}<span className="dots" /></p>}
          </div>
          <div className="bj-foot">
            {me && <span>Bankroll <b>🪙 {fmt(me.stack)}</b></span>}
            <button className="pill ghost sm" onClick={() => go("/history?game=blackjack")}>🏆 Leaderboard</button>
            {!live && <button className="pill ghost sm" onClick={newTable}>Play another table</button>}
            {live && me && <button className="pill ghost sm" onClick={() => { T.leave(); go("/"); }}>Leave table</button>}
            <span className="muted tiny">Table {room} · {bot} bots · round {pub.round}</span>
          </div>
          <details className="bj-log"><summary className="muted small">Table log</summary>{pub.log.slice().reverse().map((e, i) => <div key={i} className="tiny muted">{e.text || (e.card ? `${e.t === "dealer" ? "Dealer" : pub.seats[e.seat ?? 0]?.name} draws ${e.card}` : e.t)}</div>)}</details>
        </div>
        {panel}
      </div>
    </div>
  );
}
