// Multi-browser Spy Words test (classic: 4 phones, duet: 2 phones) against a running app + live Supabase.
// Also captures every Supabase HTTP response + realtime websocket frame each guesser receives and asserts the key never appears.
// Usage: BASE=http://localhost:4317 node scripts/e2eSpyWords.mjs
import { chromium, devices } from "playwright-core";
const BASE = process.env.BASE || "http://localhost:4317";
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? "  ✓ " : "  ✗ ") + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = process.env.SHOTS || "/tmp/sw-shots";

async function phone(name) {
  const ctx = await browser.newContext({ ...devices["iPhone 13"], isMobile: true });
  await ctx.addInitScript((n) => { localStorage.setItem("gm_player", n); localStorage.setItem("gm_sound", "off"); }, name);
  const page = await ctx.newPage(); const traffic = []; let key = null;
  page.on("response", async (r) => { if (!r.url().includes("supabase.co")) return; try { const t = await r.text(); traffic.push(t); if (r.url().includes("/rpc/spy_key") && r.ok()) key = JSON.parse(t); } catch {} });
  page.on("websocket", (ws) => ws.on("framereceived", (f) => traffic.push(String(f.payload))));
  page.on("pageerror", (e) => fails.push(`${name} page error: ${e.message}`));
  return { name, ctx, page, traffic, getKey: () => key };
}
const cardIdx = async (p, word) => (await p.page.$$eval(".sw-card .fit-text", (els) => els.map((e) => e.textContent))).indexOf(word);
const words = (p) => p.page.$$eval(".sw-card .fit-text", (els) => els.map((e) => e.textContent));

console.log("Classic (4 phones)");
{
  const [hal, rita, bo, bea] = await Promise.all(["Hal", "Rita", "Bo", "Bea"].map(phone));
  await hal.page.goto(`${BASE}/#/`); await hal.page.getByText("Spy Words").first().waitFor();
  ok(await hal.page.locator(".card", { hasText: "Spy Words" }).count() === 1, "Spy Words tile in lobby game list");
  await hal.page.locator(".card", { hasText: "Spy Words" }).getByText("Create a room").click();
  await hal.page.getByText("Classic · Red vs Blue").click(); await hal.page.getByText("Create room").click();
  await hal.page.waitForURL(/spywords\?room=/); const room = new URL(hal.page.url().replace("#/", "")).searchParams.get("room");
  ok(!!room, `room created (${room})`);
  for (const p of [rita, bo, bea]) await p.page.goto(`${BASE}/#/lobby?room=${room}`); // share link
  for (const p of [rita, bo, bea]) await p.page.waitForURL(/spywords\?room=/);
  ok(true, "share link (/lobby?room=) routes joiners into the room");
  const joinTeam = async (p, team, spy) => { await p.page.getByRole("button", { name: `Join ${team}` }).click(); await sleep(600); if (spy) { await p.page.getByRole("button", { name: /Be spymaster/ }).click(); await sleep(600); } };
  await joinTeam(hal, "Red", true); await joinTeam(rita, "Red", false); await joinTeam(bo, "Blue", true); await joinTeam(bea, "Blue", false);
  await sleep(1500);
  ok(await rita.page.locator(".sw-team.red").getByText("Hal").count() > 0 && await rita.page.locator(".sw-team.blue").getByText("Bo").count() > 0, "teams sync live to every phone");
  ok(await rita.page.getByRole("button", { name: "Start game" }).count() === 0, "non-host has no start button");
  await hal.page.getByRole("button", { name: "Start game" }).click();
  await Promise.all([hal, rita, bo, bea].map((p) => p.page.locator(".sw-card").nth(24).waitFor()));
  await sleep(1500);
  await hal.page.screenshot({ path: `${shots}/classic-spymaster.png` }); await rita.page.screenshot({ path: `${shots}/classic-guesser.png` });
  const key = hal.getKey(); const W = await words(hal);
  ok(key?.length === 25, "spymaster browser received the key via spy_key");
  ok(JSON.stringify(W) === JSON.stringify(await words(bea)), "all phones show the same 25 words");
  ok(await hal.page.locator(".sw-card.hint").count() === 25 && await bo.page.locator(".sw-card.hint").count() === 25, "spymasters see the key tint");
  ok(await rita.page.locator(".sw-card.hint").count() === 0 && await bea.page.locator(".sw-card.hint").count() === 0, "guessers see no key tint");
  const startRed = await hal.page.locator(".sw-count.red.on").count() === 1;
  const [sm, gu, osm, ogu, team, oteam] = startRed ? [hal, rita, bo, bea, "red", "blue"] : [bo, bea, hal, rita, "blue", "red"];
  // clue validation in UI
  await sm.page.locator(".sw-clueform input").fill(W[0]); await sleep(200);
  ok(await sm.page.getByRole("button", { name: "Give clue" }).isDisabled() && await sm.page.locator(".sw-clueform .warn").count() === 1, "board-word clue blocked in UI");
  ok(await gu.page.locator(".sw-clueform").count() === 0, "guessers get no clue form");
  await sm.page.locator(".sw-clueform input").fill("zzyzx"); await sm.page.locator(".sw-nums button", { hasText: /^2$/ }).click(); await sm.page.getByRole("button", { name: "Give clue" }).click();
  await gu.page.locator(".sw-clue").waitFor(); ok((await gu.page.locator(".sw-clue").innerText()).includes("ZZYZX"), "guessers see clue ZZYZX 2 live");
  // point + reveal a correct word
  const good = key.map((c, i) => [c, i]).filter(([c]) => c === team).map(([, i]) => i);
  await gu.page.locator(".sw-card").nth(good[0]).click(); await sleep(1200);
  ok(await sm.page.locator(".sw-card").nth(good[0]).locator(".sw-pointers i").count() === 1, "pointing shows on other phones (live)");
  await gu.page.locator(".sw-card").nth(good[0]).click(); await sleep(1500);
  ok(await osm.page.locator(".sw-card").nth(good[0]).getAttribute("class").then((c) => c.includes(`revealed ${team}`)), "reveal syncs to all phones with team color");
  ok(await gu.page.getByText(/2 guesses left/).count() === 1, "guess counter = number+1 minus guesses");
  await gu.page.getByRole("button", { name: "End turn" }).click(); await sleep(1500);
  ok(await osm.page.locator(".sw-clueform").count() === 1, "End turn passes to other spymaster");
  await osm.page.locator(".sw-clueform input").fill("plugh"); await osm.page.locator(".sw-nums button", { hasText: /^1$/ }).click(); await osm.page.getByRole("button", { name: "Give clue" }).click();
  await ogu.page.locator(".sw-clue").waitFor(); await sleep(500);
  ok(await sm.page.locator(".sw-log-row").count() === 2, "clue log has both clues");
  const ass = key.indexOf("assassin");
  // before game over: guesser traffic must not contain the key
  const keyJson = JSON.stringify(key);
  for (const p of [rita, bea].filter((p) => p !== sm && p !== osm)) {
    const all = p.traffic.join("\n");
    ok(!all.includes(keyJson) && !all.includes('"assassin"') && !/"neutral"/.test(all) && !p.getKey(), `${p.name} (guesser) never received key data over HTTP/realtime (${p.traffic.length} msgs scanned)`);
  }
  await ogu.page.locator(".sw-card").nth(ass).click(); await sleep(300); await ogu.page.locator(".sw-card").nth(ass).click(); await sleep(2500);
  ok((await hal.page.locator(".sw-banner").innerText()).includes(`${team === "red" ? "Red" : "Blue"} team wins`), "assassin = instant loss; winner banner on all phones");
  ok(await rita.page.locator(".sw-card.hint").count() > 0, "full key revealed to everyone after game over");
  await rita.page.screenshot({ path: `${shots}/classic-over.png` });
  await hal.page.getByRole("button", { name: "Session history" }).last().click(); await sleep(2000);
  ok((await hal.page.locator("table").last().innerText()).includes("Spy Words"), "results in session history");
  await hal.page.screenshot({ path: `${shots}/history.png` });
  for (const p of [hal, rita, bo, bea]) await p.ctx.close();
}

console.log("Duo co-op (2 phones)");
{
  const [ann, ben] = await Promise.all(["Ann", "Ben"].map(phone));
  await ann.page.goto(`${BASE}/#/play/spywords`); await ann.page.getByText("Duo co-op").first().click(); await ann.page.getByText("Create room").click();
  await ann.page.waitForURL(/spywords\?room=/); const url = ann.page.url();
  await ben.page.goto(url); await ben.page.getByText("Agent A").first().waitFor();
  await ann.page.locator(".sw-team", { hasText: "Agent A" }).getByRole("button", { name: "Sit here" }).click(); await sleep(800);
  await ben.page.locator(".sw-team", { hasText: "Agent B" }).getByRole("button", { name: "Sit here" }).click(); await sleep(1200);
  await ann.page.getByRole("button", { name: "Start game" }).click();
  await Promise.all([ann, ben].map((p) => p.page.locator(".sw-card").nth(24).waitFor())); await sleep(1500);
  const ka = ann.getKey(), kb = ben.getKey();
  ok(ka?.length === 25 && kb?.length === 25 && JSON.stringify(ka) !== JSON.stringify(kb), "each agent got only their own half of the key");
  ok(!ann.traffic.join("").includes(JSON.stringify(kb)) && !ben.traffic.join("").includes(JSON.stringify(ka)), "neither agent received the partner's half");
  ok(await ann.page.locator(".sw-card.hint.green").count() === 9 && await ben.page.locator(".sw-card.hint.green").count() === 9, "each sees 9 greens on their side");
  await ann.page.screenshot({ path: `${shots}/duet-a.png` });
  const giverIsA = (await ann.page.locator(".sw-clueform").count()) === 1;
  const [giver, guesser, gk] = giverIsA ? [ann, ben, ka] : [ben, ann, kb];
  await giver.page.locator(".sw-clueform input").fill("xyzzy"); await giver.page.getByRole("button", { name: "Give clue" }).click(); await guesser.page.locator(".sw-clue").waitFor();
  const g = gk.indexOf("green"), n = gk.indexOf("neutral");
  for (const i of [g, n]) { await guesser.page.locator(".sw-card").nth(i).click(); await sleep(300); await guesser.page.locator(".sw-card").nth(i).click(); await sleep(1500); }
  ok(await giver.page.locator(".sw-card.revealed.green").count() === 1, "green guess revealed for both");
  ok(await giver.page.locator(".sw-card").nth(n).locator(".sw-by b").count() === 1, "bystander marked for the giver's side");
  ok((await ann.page.locator(".sw-turns small").innerText()).includes("8 turns left"), "bystander ended the turn and cost it (8 left)");
  ok(await guesser.page.locator(".sw-clueform").count() === 1, "clue giving alternates to the other agent");
  await ben.page.screenshot({ path: `${shots}/duet-b.png` });
  for (const p of [ann, ben]) await p.ctx.close();
}
await browser.close();
console.log(fails.length ? `FAIL (${fails.length})\n - ${fails.join("\n - ")}` : "PASS"); process.exit(fails.length ? 1 : 0);
