import { useEffect, useState } from "react";
import { go } from "../lib/router";
import { ensurePlayer } from "../lib/player";
import { soundOn, setSound, rememberRoom, rememberPeers } from "../lib/fx";
import { Avatar } from "../Lobby";
import { fmtTime } from "../lib/daily";

export function GameHeader({ title, game, room, status, peers, cap }: { title: string; game: string; puzzleId?: number; room: string | null; status: string; peers?: string[]; cap?: number }) {
  const [copied, setCopied] = useState(false);
  const [snd, setSnd] = useState(soundOn());
  const link = location.href;
  useEffect(() => { if (room) { ensurePlayer(); rememberRoom({ room, game, url: location.hash.slice(1) }); } }, [room]);
  useEffect(() => { if (peers?.length) rememberPeers(peers); }, [peers?.length]);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Copy this link", link); } };
  const full = cap && peers ? peers.length + 1 > cap : false;
  return (
    <header className="game-header">
      <button className="back" onClick={() => go("/")} aria-label="Home">‹ Lobby</button>
      <h1>{title}</h1>
      <button className="icon-btn" title="Sound" onClick={() => { setSound(!snd); setSnd(!snd); }}>{snd ? "🔊" : "🔇"}</button>
      <div className="room-bar">
        {room ? (
          <>
            <span className={`dot ${status}`} title={status} /> <span className="muted">{status === "live" ? "Live" : status}</span>
            {peers && peers.length > 0 && <span className="peer-avatars">{peers.slice(0, 8).map((p) => <Avatar key={p} name={p} size={24} />)}{peers.length > 8 && <span className="muted"> +{peers.length - 8}</span>}</span>}
            {full && <span className="warn">Room is over its {cap}-player cap</span>}
            <button className="pill" onClick={copy}>{copied ? "Copied!" : "Copy invite link"}</button>
            <button className="pill ghost" onClick={() => go(`/history?room=${room}`)}>Session history</button>
          </>
        ) : (
          <button className="pill" onClick={() => go(`/play/${game}`)}>Play with friends</button>
        )}
      </div>
    </header>
  );
}

export function Timer({ startedAt, finishedAt }: { startedAt?: number; finishedAt?: number }) {
  const [, tick] = useState(0);
  useEffect(() => { if (!startedAt || finishedAt) return; const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, [startedAt, finishedAt]);
  const s = startedAt ? Math.floor(((finishedAt ?? Date.now()) - startedAt) / 1000) : 0;
  return <span className="timer">{fmtTime(s)}</span>;
}

export function Toast({ msg }: { msg: string | null }) { return msg ? <div className="toast">{msg}</div> : null; }
export function useToast(): [string | null, (m: string) => void] {
  const [m, setM] = useState<string | null>(null);
  return [m, (x: string) => { setM(x); setTimeout(() => setM(null), 1600); }];
}

import { dailyPick } from "../lib/daily";
import { roomPuzzle } from "../lib/shared";
/** Resolves the puzzle index: ?p= param, else the room's stored puzzle, else today's daily. */
export function usePuzzleIndex(len: number, params: URLSearchParams, offset = 0): number | null {
  const room = params.get("room"); const p = params.get("p");
  const daily = dailyPick(Array.from({ length: len }), offset).index;
  const [idx, setIdx] = useState<number | null>(p !== null ? Number(p) % len : room ? null : daily);
  useEffect(() => {
    if (p !== null) { setIdx(Number(p) % len); return; }
    if (!room) { setIdx(daily); return; }
    roomPuzzle(room).then((v) => setIdx(v === null ? daily : v % len));
  }, [room, p, len, daily]);
  return idx;
}

import { usePuzzleRefresh, type Pool } from "../lib/refresh";
/** "New puzzle" / "I already played this" controls; switches everyone in the room together. */
export function PuzzleBar({ room, pool }: { room: string | null; pool: Pool }) {
  const [toast, showToast] = useToast();
  const { flags, newPuzzle, flagPlayed, me } = usePuzzleRefresh(room, pool, showToast);
  const [busy, setBusy] = useState(false);
  const go2 = async () => { setBusy(true); await newPuzzle(); setTimeout(() => setBusy(false), 1500); };
  return (
    <div className="puzzle-bar">
      {flags.length > 0 && <span className="flag-note">⚠️ {flags.join(", ")} already played this one</span>}
      {room && !flags.includes(me) && !pool.done && <button className="pill ghost sm" onClick={flagPlayed}>I already played this</button>}
      <button className={`pill sm ${pool.done || flags.length ? "" : "ghost"}`} disabled={busy} onClick={go2}>{flags.length ? "Swap puzzle" : pool.done ? "Play another" : "New puzzle"}</button>
      <Toast msg={toast} />
    </div>
  );
}
