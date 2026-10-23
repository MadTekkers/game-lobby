import { useEffect, useMemo, useRef, useState } from "react";
import { GameHeader } from "../../games/common";
import { Avatar } from "../../Lobby";
import { ensurePlayer, getPlayer, newRoomId } from "../../lib/player";
import { gameUrl } from "../../lib/lobby";
import { go } from "../../lib/router";
import { beep, confetti } from "../../lib/fx";
import { useCardTable } from "../api";
import { CardRow } from "../ui/PlayingCard";
import { TrainCard } from "../ui/TrainCard";
import { TutorTips } from "../ui/TrickTable";
import { bjTips } from "./tutor";
import { handValue, basicStrategy, sameValue, ACTION_LABEL, type Action } from "./strategy";
import type { PublicBJ } from "./engine";
import { runCoach, Replay, type CoachResult } from "./coach";
import "../cards.css";

type PSeat = PublicBJ["seats"][number];
const fmt = (n: number) => n.toLocaleString();
const totalText = (cards: (string | null)[]) => {
  const known = cards.filter(Boolean) as string[]; if (!known.length) return "";
  const v = handValue(known); if (cards.includes(null)) return `${v.total}`;
  return v.total > 21 ? "Bust" : known.length === 2 && v.total === 21 ? "BJ" : v.soft && v.total < 21 ? `${v.total - 10}/${v.total}` : `${v.total}`;
};
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
      setTips(bjTips({ cards, up: pub.dealer[0]!, hole: pub.holeHidden ? pub.tutDealer?.[1] ?? null : null, next: pub.next ?? [], basic: b, coach: c, insurance: insuranceNow }));
    }, 40);
    return () => clearTimeout(t);
  }, [tipKey, tutorial]);

  const play = (a: Action) => { beep("tap"); setHintOn(false); if (train) coachAfter(a); else setCoach(null); T.act({ t: a }); };
  const insure = (take: boolean) => { if (train) coachAfter(take ? "insure" : "noinsure"); T.act({ t: "insurance", take }); };
  const askHint = () => { setHintOn(true); T.hint(); coachAfter(null); };
  const placeBet = () => { const a = Math.max(pub!.minBet, Math.min(bet, pub!.maxBet, me!.stack)); localStorage.setItem("bj_bet", String(a)); setCoach(null); T.act({ t: "bet", amount: a }); };
  const newTable = () => go(gameUrl({ game: "blackjack", mode: live ? "live" : "solo", seats, bot, train: train ? 1 : undefined, tut: tutorial ? 1 : undefined }) + `&n=${Date.now()}`);

  if (!pub) return <div className="game bj"><GameHeader title="Blackjack" game="blackjack" room={live ? room : null} status="connecting" /><p className="center muted">{T.err || "Shuffling a fresh 6-deck shoe…"}</p></div>;

  const dealKey = pub.phase === "betting" ? pub.round - 1 : pub.round;
  const humansHere = pub.seats.filter((s) => s.kind === "human").map((s) => s.name).filter((n) => n !== getPlayer());
  const waitingOn = pub.phase === "play" && pub.turn ? pub.seats[pub.turn.seat] : null;
  const secsLeft = pub.deadline ? Math.max(0, Math.ceil((pub.deadline - now) / 1000)) : null;
  const myResult = pub.phase === "betting" ? pub.results.find((r) => r.seat === seat) : undefined;
  const others = pub.seats.map((s, i) => ({ s, i })).filter(({ i }) => i !== seat);
  const dealerTotal = totalText(pub.dealer);
  const shownDealer = pub.tutorial && pub.tutDealer ? pub.tutDealer : pub.dealer;
  const basic = hand && pub.dealer[0] ? basicStrategy(hand.cards, pub.dealer[0], legal.includes("double"), legal.includes("split")) : null;

  const seatBox = (s: PSeat, i: number, mine?: boolean) => (
    <div key={i} className={`bj-seat-wrap`}>
    <div className={`bj-seat ${mine ? "mine" : ""} ${pub.turn?.seat === i ? "turn" : ""} ${s.kind}`}>
      <div className="bj-seat-h"><Avatar name={s.name} size={mine ? 28 : 22} /><b className="nm">{mine ? "You" : s.name}</b><span className="stack">🪙 {fmt(s.stack)}</span></div>
      {s.pending && <div className="tiny muted">↪ {s.pending.name} joins next hand</div>}
      <div className="bj-hands">
        {s.hands.length === 0 ? <div className="bj-empty">{pub.phase === "betting" ? (s.decided ? (s.bet ? `Bet ${s.bet}` : "Sitting out") : s.kind === "human" ? "Betting…" : "") : "—"}</div> :
          s.hands.map((h, k) => (
            <div key={`${dealKey}-${k}`} className={`bj-hand ${pub.turn?.seat === i && pub.turn.hand === k ? "active" : ""}`}>
              <CardRow cards={h.cards} small={!mine} />
              <div className="bj-hand-f"><span className="tot">{totalText(h.cards)}</span><span className="chip">{h.bet}{h.doubled ? "×2" : ""}</span>{h.result && <span className={`res ${h.result}`}>{RESULT[h.result]}</span>}</div>
            </div>))}
      </div>
      {pub.turn?.seat === i && secsLeft !== null && <div className="clock"><i style={{ width: `${Math.min(100, (secsLeft / 30) * 100)}%` }} /></div>}
    </div>
    </div>
  );

  return (
    <div className="game bj">
      <GameHeader title="Blackjack" game="blackjack" room={live ? room : null} status={T.err ? "offline" : "live"} peers={humansHere} />
      <div className="felt">
        <div className="bj-dealer">
          <div className="bj-label">Dealer <span className="muted">· stands on all 17s · BJ pays 3:2</span></div>
          <div key={dealKey} className="bj-dealer-cards">{pub.dealer.length ? <CardRow cards={shownDealer} /> : <div className="bj-empty">Place your bets</div>}</div>
          {dealerTotal && <div className="tot big">{pub.tutorial && pub.holeHidden && pub.tutDealer?.length ? `${dealerTotal} (+ hole ${totalText(pub.tutDealer)})` : dealerTotal}</div>}
          {pub.tutorial && pub.next && <div className="tiny tut-next">📖 Next in the shoe: <CardRow cards={pub.next} small /></div>}
          <div className="shoe" title="Cards left in the shoe"><i style={{ width: `${(pub.shoeLeft / pub.shoeSize) * 100}%` }} /><span>{pub.reshuffled ? "New shoe" : `Shoe ${Math.round((pub.shoeLeft / pub.shoeSize) * 100)}%`}</span></div>
        </div>
        <div className={`bj-others n${others.length}`}>{others.map(({ s, i }) => seatBox(s, i))}</div>
        {me && seatBox(me, seat, true)}
      </div>

      {myResult && <div className={`bj-banner ${myResult.net > 0 ? "good" : myResult.net < 0 ? "bad" : ""}`}>{myResult.net > 0 ? `+${fmt(myResult.net)} chips` : myResult.net < 0 ? `−${fmt(-myResult.net)} chips` : "Push — bet returned"}</div>}
      {T.err && <p className="warn center">{T.err}</p>}

      {tutorial && tips && (myTurn || insuranceNow) && <TutorTips tips={tips} busy={false} sample="Odds come from the Monte Carlo coach using only the cards a real player sees; the Peek line uses the face-up cards." />}
      {coach && <TrainCard rows={coach.rows} chosen={coach.chosen} title={coach.chosen ? "Coach — how your move compares" : "Hint — every option, simulated"} gapText={coach.gap}
        sample={`Probabilities from ${coach.n.toLocaleString()} Monte Carlo hands per option.`} onClose={() => setCoach(null)} replay={(k) => <Replay input={coach.input} action={k} />} />}
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
        {insuranceNow && (<div className="controls"><span className="muted">Dealer shows an ace. Insurance costs {Math.floor(me!.bet / 2)}.</span>
          <button className="pill" disabled={T.busy} onClick={() => insure(true)}>Take insurance</button><button className="pill ghost" disabled={T.busy} onClick={() => insure(false)}>No thanks</button></div>)}
        {pub.phase === "insurance" && !insuranceNow && <p className="muted center">Others are deciding on insurance<span className="dots" /></p>}
        {myTurn && (<>
          <div className="controls acts">{(["hit", "stand", "double", "split"] as Action[]).map((a) => <button key={a} className={`pill act ${a} ${hintOn && basic === a ? "hinted" : ""}`} disabled={T.busy || !legal.includes(a)} onClick={() => play(a)}>{ACTION_LABEL[a]}</button>)}</div>
          <div className="controls"><button className="pill ghost sm" onClick={askHint}>💡 Hint</button>{secsLeft !== null && <span className="muted small">{secsLeft}s</span>}</div>
          {hintOn && basic && <p className="center small">Basic strategy: <b>{ACTION_LABEL[basic]}</b></p>}
        </>)}
        {pub.phase === "play" && !myTurn && waitingOn && <p className="muted center">{waitingOn.kind === "bot" ? "Bots are playing" : `${waitingOn.name} is deciding`}<span className="dots" /></p>}
      </div>

      {!coach && train && <p className="muted small center">🎓 Train mode: after each decision, a coach card compares your move with the alternatives.</p>}

      <div className="bj-foot">
        {me && <span>Bankroll <b>🪙 {fmt(me.stack)}</b></span>}
        <button className="pill ghost sm" onClick={() => go("/history?game=blackjack")}>🏆 Leaderboard</button>
        {!live && <button className="pill ghost sm" onClick={newTable}>Play another table</button>}
        {live && me && <button className="pill ghost sm" onClick={() => { T.leave(); go("/"); }}>Leave table</button>}
        <span className="muted tiny">Table {room} · {bot} bots · round {pub.round}</span>
      </div>
      <details className="bj-log"><summary className="muted small">Table log</summary>{pub.log.slice().reverse().map((e, i) => <div key={i} className="tiny muted">{e.text || (e.card ? `${e.t === "dealer" ? "Dealer" : pub.seats[e.seat ?? 0]?.name} draws ${e.card}` : e.t)}</div>)}</details>
    </div>
  );
}
