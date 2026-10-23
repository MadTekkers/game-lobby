// Copies the pure-TS card engines into the edge function bundle (supabase/functions/cards/lib) so client and server run identical rules.
import { cpSync, rmSync } from "node:fs";
const dst = new URL("../supabase/functions/cards/lib/", import.meta.url);
rmSync(dst, { recursive: true, force: true });
cpSync(new URL("../src/cards/", import.meta.url), dst, { recursive: true, filter: (p) => !p.endsWith(".tsx") && !p.includes("/ui") && !/sim\.ts$/.test(p) });
console.log("synced src/cards -> supabase/functions/cards/lib");
