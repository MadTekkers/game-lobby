import { useEffect, useState } from "react";
export function parseHash() {
  const h = window.location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}
export function useRoute() {
  const [r, setR] = useState(parseHash());
  useEffect(() => { const f = () => setR(parseHash()); window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  return r;
}
export const go = (h: string) => { window.location.hash = h; };
