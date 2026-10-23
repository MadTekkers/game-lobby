import { useEffect, useMemo, useRef, useState } from "react";
import { GameHeader, Timer, Toast, useToast } from "../common";
import { Avatar } from "../../Lobby";
import { FitText } from "../../lib/FitText";
import { beep, confetti, playerColor } from "../../lib/fx";
import { ensurePlayer, setPlayer } from "../../lib/player";
import { go } from "../../lib/router";
import { clueProblem, errText, useSpyWords, type Color, type DuetCell, type LogEntry, type Seat, type SpyGame } from "./api";
import "./spywords.css";

const TEAM_NAME: Record<string, string> = { red: "Red", blue: "Blue", A: "Agent A", B: "Agent B", sudden: "Sudden death" };
const other = (t: string) => (t === "red" ? "blue" : t === "blue" ? "red" : t === "A" ? "B" : "A");

export default function SpyWordsPage({ params }: { params: URLSearchParams }) {
  const room = params.get("room");
  useEffect(() => { ensurePlayer(); }, []);
  if (!room) return (
    <div className="page"><GameHeader title="Spy Words" game="spywords" room={null} status="solo" />
      <p className="center">Spy Words is a team game. <button className="pill" onClick={() => go("/play/spywords")}>Create a room</button></p></div>);
  return <Room room={room} />;
}

function Room({ room }: { room: string }) {
  const sw = useSpyWords(room);
  const { g, joinErr } = sw;
  const [toast, showToast] = useToast();
  if (joinErr === "name_taken") return <NameTaken room={room} retry={sw.join} />;
  return (
    <div className="page sw">
      <GameHeader title="Spy Words" game="spywords" room={room} status={sw.status} peers={sw.peers} cap={12} />
      {joinErr && <p className="warn center">{errText(joinErr)}</p>}
      {!g ? <p className="center muted">Loading room…</p> : g.phase === "setup" ? <SetupView g={g} sw={sw} toast={showToast} /> : <Board g={g} sw={sw} toast={showToast} />}
      <Toast msg={toast} />
    </div>
  );
}

function NameTaken({ room, retry }: { room: string; retry: () => void }) {
  const [n, setN] = useState("");
  return (<div className="page"><GameHeader title="Spy Words" game="spywords" room={room} status="live" />
    <div className="panel center"><p>Someone named <b>{localStorage.getItem("gm_player")}</b> is already in this game.</p>
      <div className="name-row" style={{ justifyContent: "center" }}><input value={n} placeholder="Pick another name" maxLength={40} onChange={(e) => setN(e.target.value)} />
        <button className="pill" disabled={!n.trim()} onClick={() => { setPlayer(n); retry(); location.reload(); }}>Join</button></div></div></div>);
}

type SW = ReturnType<typeof useSpyWords>;

/* ---------------- room setup: pick teams / spymasters ---------------- */
function SetupView({ g, sw, toast }: { g: SpyGame; sw: SW; toast: (m: string) => void }) {
  const me = sw.me; const mine = sw.mySeat; const isHost = g.host === me;
  const seat = async (team: string | null, spy = false) => { beep("tap"); const r = await sw.call("spy_seat", { p_team: team, p_spy: spy }); if (r.error) toast(errText(r.error)); };
  const start = async () => { const r = await sw.call("spy_start"); if (r.error) toast(errText(r.error)); };
  const bench = g.seats.filter((s) => !s.team);
  const problems = g.mode === "classic"
    ? (["red", "blue"] as const).flatMap((t) => [g.seats.some((s) => s.team === t && s.spy) ? null : `${TEAM_NAME[t]} needs a spymaster`, g.seats.some((s) => s.team === t && !s.spy) ? null : `${TEAM_NAME[t]} needs a guesser`]).filter(Boolean)
    : (["A", "B"] as const).filter((t) => !g.seats.some((s) => s.team === t)).map((t) => `${TEAM_NAME[t]} seat is empty`);
  return (
    <div className="sw-setup">
      <div className="sw-mode-tag">{g.mode === "classic" ? "🕵️ Classic · Red vs Blue" : "🤝 Duo co-op · 2 agents"}</div>
      {g.mode === "classic" ? (
        <div className="sw-teams">
          {(["red", "blue"] as const).map((t) => { const spy = g.seats.find((s) => s.team === t && s.spy); const gs = g.seats.filter((s) => s.team === t && !s.spy); return (
            <div key={t} className={`sw-team ${t} pop-in`}>
              <h3>{TEAM_NAME[t]} team</h3>
              <div className="sw-role">Spymaster</div>
              {spy ? <SeatChip s={spy} me={me} /> : <div className="muted small">— empty —</div>}
              <div className="sw-role">Guessers</div>
              {gs.length ? gs.map((s) => <SeatChip key={s.name} s={s} me={me} />) : <div className="muted small">— none yet —</div>}
              <div className="sw-team-btns">
                {mine?.team !== t ? <button className={`pill sw-${t}`} onClick={() => seat(t)}>Join {TEAM_NAME[t]}</button> : (
                  <button className="pill ghost" onClick={() => seat(t, !mine.spy)} disabled={!mine.spy && !!spy}>{mine.spy ? "Be a guesser" : "Be spymaster 🕵️"}</button>)}
              </div>
            </div>); })}
        </div>
      ) : (
        <div className="sw-teams">
          {(["A", "B"] as const).map((t) => { const s = g.seats.find((x) => x.team === t); return (
            <div key={t} className="sw-team green pop-in"><h3>{TEAM_NAME[t]}</h3>
              {s ? <SeatChip s={s} me={me} /> : <div className="muted small">— empty —</div>}
              <div className="sw-team-btns">{!s && <button className="pill sw-green" onClick={() => seat(t)}>Sit here</button>}</div>
            </div>); })}
        </div>
      )}
      <div className="sw-bench"><span className="muted small">Not on a team:</span> {bench.map((s) => <SeatChip key={s.name} s={s} me={me} />)}
        {mine?.team && <button className="pill ghost sm" onClick={() => seat(null)}>Leave team</button>}</div>
      <div className="controls big">
        {isHost ? <button className="pill xl" disabled={problems.length > 0} onClick={start}>Start game</button> : <p className="waiting">Waiting for {g.host} to start<span className="dots" /></p>}
      </div>
      {problems.length > 0 && <p className="muted small center">{problems.join(" · ")}</p>}
      <Rules mode={g.mode} />
    </div>
  );
}

function SeatChip({ s, me }: { s: Seat; me: string }) {
  return <span className={`player-chip pop-in ${s.name === me ? "me" : ""}`}><Avatar name={s.name} size={24} /> {s.name}{s.spy ? " 🕵️" : ""}{s.name === me ? " (you)" : ""}</span>;
}

function Rules({ mode }: { mode: SpyGame["mode"] }) {
  return mode === "classic" ? (
    <details className="sw-rules"><summary>How to play</summary>
      <p>Each team has one <b>spymaster</b> who secretly sees which of the 25 words belong to their team. On your turn the spymaster gives a <b>one-word clue + a number</b> (how many words it fits). Guessers tap a word to point at it, and tap again to reveal it. You can make up to <b>number + 1</b> guesses (0 = unlimited).</p>
      <p>Your color → keep going. Bystander (beige) or the other team's color → turn over. <b>The assassin (black) loses the game instantly.</b> First team to find all its words wins. The starting team has 9 words, the other 8.</p></details>
  ) : (
    <details className="sw-rules"><summary>How to play</summary>
      <p>You're on the same side. Each agent sees <b>their own half</b> of a two-sided key: 9 green words each (15 different greens in total) and 3 assassins. Take turns: one agent gives a one-word clue + number for greens on <b>their</b> key, the other guesses (as many as they like while correct).</p>
      <p>A bystander ends the turn (and burns it), an assassin loses. You have <b>9 turns</b> to find all 15 greens. When turns run out it's sudden death: keep guessing with no clues — one mistake loses.</p></details>
  );
}

/* ---------------- the board ---------------- */
function Board({ g, sw, toast }: { g: SpyGame; sw: SW; toast: (m: string) => void }) {
  const me = sw.me; const mine = sw.mySeat; const words = g.words || [];
  const classic = g.mode === "classic"; const over = g.phase === "over";
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [boom, setBoom] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const prevRev = useRef<string>("");
  // reveal animations + sounds when cards change
  useEffect(() => {
    const cur = JSON.stringify(g.revealed);
    if (prevRev.current && prevRev.current !== cur) {
      const before = JSON.parse(prevRev.current); const fresh = new Set<number>();
      (g.revealed as any[]).forEach((c, i) => { if (JSON.stringify(c) !== JSON.stringify(before[i])) fresh.add(i); });
      setFlipped(fresh); setTimeout(() => setFlipped(new Set()), 700);
      const last = g.log[g.log.length - 1]?.guesses.slice(-1)[0];
      if (last) { if (last.color === "assassin") { setBoom(true); setTimeout(() => setBoom(false), 900); beep("bad"); } else if ((classic && last.color === g.log[g.log.length - 1].team) || last.color === "green") beep("good"); else beep("bad"); }
    }
    prevRev.current = cur;
  }, [g.revealed]);
  const won = over && (classic ? mine?.team === g.winner : g.winner === "team");
  useEffect(() => { if (over && won) confetti(); }, [over, g.game_no]);

  // whose move is it?
  const amGiver = !over && g.phase === "clue" && (classic ? !!mine?.spy && mine.team === g.turn : mine?.team === g.turn);
  const amGuesser = !over && (g.phase === "guess" ? (classic ? mine?.team === g.turn && !mine?.spy : !!mine && (mine.team === "A" || mine.team === "B") && mine.team !== g.turn)
    : g.phase === "sudden" && !!mine && (mine.team === "A" || mine.team === "B"));
  const keyFor = (i: number): Color | null => {
    if (over && g.key_reveal) return Array.isArray(g.key_reveal) ? g.key_reveal[i] : null;
    return sw.key ? sw.key[i] : null;
  };
  const pointedBy = (i: number) => Object.entries(sw.pointers).filter(([, v]) => v === i).map(([k]) => k);
  const myPoint = sw.pointers[me] ?? null;

  const tap = async (i: number) => {
    if (!amGuesser) return;
    if (classic ? (g.revealed as (Color | null)[])[i] : (g.revealed as DuetCell[])[i]?.g) return;
    if (myPoint !== i) { beep("tap"); sw.point(i); return; }
    sw.point(null);
    const r = await sw.call("spy_guess", { p_idx: i });
    if (r.error) toast(errText(r.error));
  };

  // scores
  const rev = g.revealed;
  const classicLeft = (t: string) => (g.start_team === t ? 9 : 8) - (rev as (Color | null)[]).filter((c) => c === t).length;
  const greens = classic ? 0 : (rev as DuetCell[]).filter((c) => c?.g).length;
  const nameOf = (team: string | null, spy?: boolean) => g.seats.filter((s) => s.team === team && (spy === undefined || s.spy === spy)).map((s) => s.name).join(", ");

  return (
    <div className={`sw-game ${boom ? "sw-boom" : ""}`}>
      <div className="sw-score">
        {classic ? (<>
          <span className={`sw-count red ${g.turn === "red" && !over ? "on" : ""}`}>{classicLeft("red")}<small>Red left</small></span>
          <Timer startedAt={g.started_at ? Date.parse(g.started_at) : undefined} finishedAt={g.finished_at ? Date.parse(g.finished_at) : undefined} />
          <span className={`sw-count blue ${g.turn === "blue" && !over ? "on" : ""}`}>{classicLeft("blue")}<small>Blue left</small></span>
        </>) : (<>
          <span className="sw-count green">{greens}/15<small>agents found</small></span>
          <Timer startedAt={g.started_at ? Date.parse(g.started_at) : undefined} finishedAt={g.finished_at ? Date.parse(g.finished_at) : undefined} />
          <span className="sw-turns" title="Turns left">{Array.from({ length: 9 }, (_, i) => <i key={i} className={i < (g.turns_left ?? 0) ? "on" : ""} />)}<small>{g.turns_left} turns left</small></span>
        </>)}
      </div>

      <Banner g={g} me={me} amGiver={amGiver} amGuesser={amGuesser} nameOf={nameOf} won={won} />

      {amGiver && <ClueForm g={g} sw={sw} toast={toast} />}

      <div className="sw-main">
        <div className={`sw-grid ${amGuesser ? "can-guess" : ""}`}>
          {words.map((w, i) => {
            const k = keyFor(i);
            const pts = pointedBy(i);
            if (classic) {
              const c = (rev as (Color | null)[])[i];
              const cls = c ? `revealed ${c}` : k ? `hint ${k}` : "";
              return (
                <button key={i} className={`sw-card ${cls} ${flipped.has(i) ? "flip" : ""} ${myPoint === i ? "mine" : ""}`} onClick={() => tap(i)} disabled={!!c || !amGuesser} style={{ animationDelay: `${i * 18}ms` }}>
                  <FitText text={w} max={15} min={8} />
                  {c === "assassin" && <span className="sw-skull">☠</span>}
                  {pts.length > 0 && <span className="sw-pointers">{pts.map((p) => <i key={p} style={{ background: playerColor(p) }} title={p}>{p.slice(0, 1).toUpperCase()}</i>)}</span>}
                  {myPoint === i && <span className="sw-again">tap again</span>}
                </button>);
            }
            const c = (rev as DuetCell[])[i] || {};
            const kb = over && g.key_reveal && !Array.isArray(g.key_reveal) ? g.key_reveal : null;
            const hint = kb ? (kb.A[i] === "green" || kb.B[i] === "green" ? "green" : kb.A[i] === "assassin" || kb.B[i] === "assassin" ? "assassin" : null) : k;
            const cls = c.g ? "revealed green" : c.x ? "revealed assassin" : (c.nA && c.nB) ? "dead" : hint ? `hint ${hint}` : "";
            return (
              <button key={i} className={`sw-card ${cls} ${flipped.has(i) ? "flip" : ""} ${myPoint === i ? "mine" : ""}`} onClick={() => tap(i)} disabled={!!c.g || !amGuesser} style={{ animationDelay: `${i * 18}ms` }}>
                <FitText text={w} max={15} min={8} />
                {c.x && <span className="sw-skull">☠</span>}
                {(c.nA || c.nB) && !c.g && <span className="sw-by">{c.nA && <b title="Bystander on Agent A's key">A</b>}{c.nB && <b title="Bystander on Agent B's key">B</b>}</span>}
                {kb && !c.g && <span className="sw-dual"><i className={kb.A[i]} title="A" /><i className={kb.B[i]} title="B" /></span>}
                {pts.length > 0 && <span className="sw-pointers">{pts.map((p) => <i key={p} style={{ background: playerColor(p) }} title={p}>{p.slice(0, 1).toUpperCase()}</i>)}</span>}
                {myPoint === i && <span className="sw-again">tap again</span>}
              </button>);
          })}
        </div>
        <aside className={`sw-log ${showLog ? "open" : ""}`}>
          <h3 onClick={() => setShowLog(!showLog)}>Clue log <span className="muted small">({g.log.length})</span><span className="sw-caret">{showLog ? "▾" : "▸"}</span></h3>
          <ClueLog log={g.log} />
        </aside>
      </div>

      <div className="controls">
        {amGuesser && g.phase === "guess" && <button className="pill ghost" disabled={g.guesses_made < 1} onClick={async () => { sw.point(null); const r = await sw.call("spy_pass"); if (r.error) toast(errText(r.error)); }}>End turn</button>}
        {sw.key && !over && <span className="muted small">{classic ? "🕵️ You can see the key — guessers can't." : "🔑 Tinted words are your half of the key."}</span>}
        {over && g.host === me && <button className="pill xl" onClick={() => sw.call("spy_reset")}>Play again</button>}
      </div>
      <Roster g={g} me={me} />
    </div>
  );
}

function Banner({ g, me, amGiver, amGuesser, nameOf, won }: { g: SpyGame; me: string; amGiver: boolean; amGuesser: boolean; nameOf: (t: string | null, spy?: boolean) => string; won: boolean }) {
  const classic = g.mode === "classic"; const t = g.turn || "";
  let main: React.ReactNode, sub: React.ReactNode = null, tone = classic ? t : "green";
  if (g.phase === "over") {
    tone = classic ? g.winner || "" : g.winner === "team" ? "green" : "assassin";
    main = classic ? `${TEAM_NAME[g.winner || ""]} team wins!` : g.winner === "team" ? "Mission accomplished! 🎉" : "Mission failed";
    sub = g.reason === "assassin" ? "☠ The assassin was found." : g.reason === "sudden_death" ? "A mistake in sudden death." : `${g.turns} clue${g.turns === 1 ? "" : "s"} given.`;
    if (classic) sub = <>{sub} {won ? "Nice work!" : ""}</>;
  } else if (g.phase === "clue") {
    main = amGiver ? "Your turn to give a clue" : classic ? `${TEAM_NAME[t]} spymaster ${nameOf(t, true)} is thinking…` : `${nameOf(t)} is thinking of a clue…`;
    sub = classic ? null : `${nameOf(t)} gives the clue · ${nameOf(other(t))} guesses`;
  } else if (g.phase === "guess" && g.clue) {
    main = <span className="sw-clue">{g.clue.word} <b>{g.clue.n === 0 ? "∞" : g.clue.n}</b></span>;
    sub = amGuesser ? (classic ? `Tap a word to point, tap again to reveal · ${g.guesses_left} guess${g.guesses_left === 1 ? "" : "es"} left` : "Tap a word to point, tap again to reveal · keep going while you're right")
      : classic ? `${TEAM_NAME[t]} team is guessing (${nameOf(t, false)}) · ${g.guesses_left} left` : `${nameOf(other(t))} is guessing`;
  } else if (g.phase === "sudden") {
    tone = "assassin"; main = "⏳ Sudden death!"; sub = "Out of turns. No more clues — tap words that are green on your partner's key. One mistake loses.";
  }
  return <div key={`${g.phase}-${g.turns}`} className={`sw-banner ${tone} pop-in`}><div className="sw-banner-main">{main}</div>{sub && <div className="sw-banner-sub">{sub}</div>}{me && null}</div>;
}

function ClueForm({ g, sw, toast }: { g: SpyGame; sw: SW; toast: (m: string) => void }) {
  const [w, setW] = useState(""); const [n, setN] = useState(1); const [busy, setBusy] = useState(false);
  const prob = w ? clueProblem(w, g.words || []) : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); const p = clueProblem(w, g.words || []); if (p) { toast(p); return; }
    setBusy(true); const r = await sw.call("spy_clue", { p_word: w.trim(), p_n: n }); setBusy(false);
    if (r.error) toast(errText(r.error)); else { beep("good"); setW(""); }
  };
  return (
    <form className="sw-clueform pop-in" onSubmit={submit}>
      <input value={w} onChange={(e) => setW(e.target.value.replace(/\s/g, ""))} placeholder="One-word clue" maxLength={24} autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} />
      <div className="sw-nums">{Array.from({ length: 10 }, (_, i) => <button type="button" key={i} className={n === i ? "on" : ""} onClick={() => setN(i)} title={i === 0 ? "0 = unlimited" : undefined}>{i === 0 ? "∞" : i}</button>)}</div>
      <button className="pill" disabled={!w || !!prob || busy}>Give clue</button>
      {prob && <div className="warn">{prob}</div>}
    </form>
  );
}

function ClueLog({ log }: { log: LogEntry[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [log.length, log[log.length - 1]?.guesses.length]);
  if (!log.length) return <p className="muted small">No clues yet.</p>;
  return (<div className="sw-log-list">{log.map((e, i) => (
    <div key={i} className={`sw-log-row ${e.team}`}>
      <div><span className={`sw-dot ${e.team}`} /> {e.word ? <><b>{e.word}</b> {e.n === 0 ? "∞" : e.n}</> : <b>Sudden death</b>} <span className="muted small">· {e.by}</span></div>
      <div className="sw-log-guesses">{e.guesses.map((x, j) => <span key={j} className={`sw-chip ${x.color}`} title={`${x.by}`}>{x.word}</span>)}</div>
    </div>))}<div ref={end} /></div>);
}

function Roster({ g, me }: { g: SpyGame; me: string }) {
  const groups = useMemo(() => g.mode === "classic" ? (["red", "blue"] as const).map((t) => ({ t, s: g.seats.filter((x) => x.team === t) })) : (["A", "B"] as const).map((t) => ({ t, s: g.seats.filter((x) => x.team === t) })), [g.seats, g.mode]);
  const watchers = g.seats.filter((s) => !s.team);
  return (<div className="sw-roster">
    {groups.map(({ t, s }) => <div key={t} className={`sw-roster-team ${t}`}><b>{TEAM_NAME[t]}</b> {s.map((x) => <SeatChip key={x.name} s={x} me={me} />)}</div>)}
    {watchers.length > 0 && <div className="sw-roster-team"><b>Watching</b> {watchers.map((x) => <SeatChip key={x.name} s={x} me={me} />)}</div>}
  </div>);
}
