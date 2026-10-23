// Copies the pure-TS card engines into the edge function bundle (supabase/functions/cards/lib) so client and server run identical rules.
// Skips client-only code: React (.tsx), UI, styles, the browser API wrapper and the Blackjack coach simulator.
import { cpSync, rmSync } from "node:fs";
const dst = new URL("../supabase/functions/cards/lib/", import.meta.url);
rmSync(dst, { recursive: true, force: true });
const skip = (p) => p.endsWith(".tsx") || p.endsWith(".css") || p.includes("/ui") || /\/api\.ts$/.test(p) || /blackjack\/sim\.ts$/.test(p) || /\/coach[^/]*\.ts$/.test(p);
cpSync(new URL("../src/cards/", import.meta.url), dst, { recursive: true, filter: (p) => !skip(p) });
console.log("synced src/cards -> supabase/functions/cards/lib");
// Also emit a single-file bundle (dist-fn/cards.ts) — handy for deploying through APIs that take one file.
import { build } from "rolldown";
await build({ input: new URL("../supabase/functions/cards/index.ts", import.meta.url).pathname, external: [/^npm:/, /^jsr:/], platform: "neutral", output: { file: new URL("../dist-fn/cards.ts", import.meta.url).pathname, format: "esm" }, logLevel: "warn" });
console.log("bundled -> dist-fn/cards.ts");
