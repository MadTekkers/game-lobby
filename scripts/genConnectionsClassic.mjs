// Rebuilds the bundled "Classic" Connections medium + hard lists with the v2 generator (same quotas as the weekly sets).
// node scripts/genConnectionsClassic.mjs [mediumCount=40] [hardCount=40]
import fs from "fs";
import { weekCtx, genSlot, groupKey } from "./weekly/connectionsWeek.mjs";
function rng(s) { s = s >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
const N = { medium: +(process.argv[2] || 40), hard: +(process.argv[3] || 40) };
const fps = { medium: new Set(), hard: new Set(), easy: new Set() }, groups = new Set(); const out = { medium: [], hard: [] };
for (let b = 0; b * 7 < Math.max(N.medium, N.hard); b++) { // blocks of 7 = one "week" of variety rules
  const wc = weekCtx([]); const r = rng(9001 + b);
  for (const d of ["medium", "hard"]) for (let i = 0; i < 7 && out[d].length < N[d]; i++) { const { data } = genSlot(d, 50000 + b * 100 + i * 7 + d.length, wc, fps[d], groups, r); out[d].push({ id: out[d].length + 1, ...data }); }
}
fs.writeFileSync("src/data/connections-medium.json", JSON.stringify(out.medium));
fs.writeFileSync("src/data/connections-hard.json", JSON.stringify(out.hard));
console.log("classic medium", out.medium.length, "hard", out.hard.length);
