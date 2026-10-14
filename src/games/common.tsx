import { useEffect, useState } from "react";
import { go } from "../lib/router";
import { ensurePlayer, newRoomId } from "../lib/player";
import { fmtTime } from "../lib/daily";

export function GameHeader({ title, game, puzzleId, room, status, peers }: { title: string; game: string; puzzleId: number; room: string | null; status: string; peers?: string[] }) {
  const [copied, setCopied] = useState(false);
  const link = room ? `${location.origin}${location.pathname}#/${game}?room=${room}` : "";
  const start = () => { ensurePlayer(); go(`/${game}?room=${newRoomId()}&p=${puzzleId}`); };
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt("Copy this link", link); } };
  return (
    <header className="game-header">
      <button className="back" onClick={() => go("/")} aria-label="Home">‹ Games</button>
      <h1>{title}</h1>
      <div className="room-bar">
        {room ? (
          <>
            <span className={`dot ${status}`} title={status} /> <span className="muted">{status === "live" ? "Live" : status}</span>
            {peers && peers.length > 0 && <span className="muted"> · with {peers.join(", ")}</span>}
            <button className="pill" onClick={copy}>{copied ? "Copied!" : "Copy invite link"}</button>
            <button className="pill ghost" onClick={() => go(`/history?room=${room}`)}>Session history</button>
          </>
        ) : (
          <button className="pill" onClick={start}>Play with a friend</button>
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
    roomPuzzle(room).then((v) => setIdx(v ?? daily));
  }, [room, p, len, daily]);
  return idx;
}
