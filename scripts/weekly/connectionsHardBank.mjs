// Hard Connections: wordplay groups (levels 2-3) + surface groups (levels 0-1).
// A red herring is a wordplay word that also belongs to a chosen surface category (e.g. TANGO in "Hidden colors" + "Dances").
export const wordplay = [
  [3, "Hidden animals", ["SCATTER", "BEARD", "DOGMA", "CRATE", "ANTLER", "PIGMENT"]],
  [3, "Hidden colors", ["STEAL", "BORED", "TANGO", "ROSEMARY", "SCARED"]],
  [3, "Hidden numbers", ["OFTEN", "CANINE", "WEIGHT", "STONE", "LONELY", "ATTENTION"]],
  [3, "Hidden body parts", ["CHINA", "CHARM", "SHIPPING", "LEGEND", "SHINE", "EARNEST"]],
  [3, "Hidden pronouns", ["SHED", "WHIM", "THEMES", "YOUTH", "ITCH"]],
  [3, "Hidden ART", ["PARTY", "CHART", "SMART", "DARTS", "START"]],
  [2, "Sound like letters", ["SEA", "TEA", "EYE", "YOU", "WHY", "PEA", "BEE", "JAY", "QUEUE"]],
  [2, "Sound like numbers", ["WON", "TOO", "FOR", "ATE"]],
  [2, "Sound like fruits", ["PAIR", "PLUMB", "BURY", "CURRENT"]],
  [2, "Sound like weather words", ["REIN", "HALE", "WHETHER", "SON", "MISSED"]],
  [2, "Sound like vegetables", ["LEAK", "BEAT", "BEEN", "CHARRED", "PEACE"]],
  [2, "___BALL", ["FOOT", "BASKET", "SNOW", "MEAT", "EYE", "DODGE", "HAND", "BASE"]],
  [2, "___FISH", ["STAR", "SWORD", "CAT", "JELLY", "GOLD", "SHELL"]],
  [2, "FIRE___", ["WORK", "PLACE", "FLY", "MAN", "WOOD", "ARM", "TRUCK"]],
  [2, "___CAKE", ["CUP", "PAN", "CHEESE", "SHORT", "FRUIT", "PATTY"]],
  [2, "___BOARD", ["SKATE", "KEY", "CARD", "DASH", "SURF", "CLIP", "CHALK"]],
  [2, "SUN___", ["FLOWER", "GLASSES", "BURN", "DIAL", "RISE", "SET"]],
  [2, "Peter ___", ["PIPER", "RABBIT", "PARKER", "PAN", "GRIFFIN"]],
  [3, "Anagrams of LISTEN", ["SILENT", "ENLIST", "TINSEL", "INLETS"]],
  [3, "Anagrams of STOP", ["POTS", "TOPS", "SPOT", "OPTS", "POST"]],
  [3, "Anagrams of RATS", ["STAR", "ARTS", "TSAR", "TARS"]],
  [3, "Add S to the front", ["PEAR", "LICE", "TRAP", "WING", "NAIL", "TOOL"]],
];
export const surface = [
  [0, "Herbs", ["BASIL", "THYME", "SAGE", "DILL", "ROSEMARY", "MINT"]],
  [0, "Teeth", ["MOLAR", "INCISOR", "PREMOLAR", "WISDOM", "CANINE"]],
  [1, "Units of weight", ["POUND", "OUNCE", "GRAM", "CARAT", "STONE", "TON"]],
  [0, "Countries", ["PERU", "CHAD", "MALI", "CUBA", "CHINA", "OMAN"]],
  [1, "Tall tales", ["MYTH", "FABLE", "YARN", "SAGA", "LEGEND"]],
  [0, "Insects", ["ANT", "BEE", "MOTH", "WASP", "FLY", "GNAT"]],
  [1, "Christmas decorations", ["WREATH", "STAR", "BAUBLE", "ANGEL", "TINSEL"]],
  [0, "Kitchen items", ["POT", "WOK", "KETTLE", "LADLE", "PAN"]],
  [0, "Fish", ["COD", "TROUT", "SALMON", "BASS", "SKATE"]],
  [0, "Hot drinks", ["TEA", "COCOA", "COFFEE", "CIDER", "CHAI"]],
  [0, "In the sky", ["MOON", "CLOUD", "COMET", "RAINBOW", "STAR", "SUN"]],
  [1, "Toast toppings", ["JAM", "HONEY", "NUTELLA", "MARMITE", "JELLY", "BUTTER"]],
  [0, "Hand tools", ["HAMMER", "SAW", "DRILL", "FILE", "WRENCH"]],
  [1, "Facial hair", ["BEARD", "MUSTACHE", "GOATEE", "STUBBLE", "SIDEBURNS"]],
  [1, "Beliefs", ["DOGMA", "CREED", "TENET", "CANON", "DOCTRINE"]],
  [1, "Containers", ["CRATE", "CHEST", "CARTON", "CASE", "BIN"]],
  [1, "Deer features", ["ANTLER", "HOOF", "HIDE", "TAIL", "COAT"]],
  [1, "Paint ingredients", ["PIGMENT", "BINDER", "SOLVENT", "OIL", "RESIN"]],
  [0, "Dances", ["SALSA", "WALTZ", "RUMBA", "POLKA", "TANGO"]],
  [0, "Sports", ["GOLF", "TENNIS", "RUGBY", "POLO", "DARTS"]],
  [1, "Charts", ["GRAPH", "TABLE", "PLOT", "DIAGRAM", "CHART"]],
  [0, "Body of water", ["SEA", "LAKE", "POND", "BAY", "LAGOON"]],
  [1, "Jewelry", ["RING", "CHARM", "LOCKET", "BANGLE", "BROOCH"]],
  [1, "Shipping terms", ["FREIGHT", "CARGO", "PARCEL", "DELIVERY", "SHIPPING"]],
  [0, "Birds", ["ROBIN", "HERON", "FINCH", "OWL", "JAY", "WREN"]],
  [1, "Shades of yellow", ["GOLD", "LEMON", "MUSTARD", "AMBER", "CANARY"]],
  [1, "Bread rolls", ["BUN", "BAP", "COB", "BAGEL", "BRIOCHE"]],
  [0, "Cutlery", ["FORK", "KNIFE", "SPOON", "LADLE", "SPORK"]],
];
function rng(s) { return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
const shuffle = (a, r) => [...a].sort(() => r() - 0.5);
/** Two wordplay groups + two surface groups, with >=1 red herring. */
export function makeHard(seed) {
  const r = rng((Math.imul(seed, 2654435) + 7) >>> 0);
  for (let t = 0; t < 3000; t++) {
    const [wpA, wpB] = shuffle(wordplay, r);
    if (wpA[1] === wpB[1]) continue;
    // herring: a surface category sharing a word with wpA
    const herringCats = surface.filter((s) => s[2].some((w) => wpA[2].includes(w)));
    if (!herringCats.length) continue;
    const s1 = herringCats[Math.floor(r() * herringCats.length)];
    const s2 = shuffle(surface, r).find((s) => s !== s1 && s[0] !== s1[0]) || shuffle(surface, r).find((s) => s !== s1);
    const used = new Set(); const groups = [];
    const herring = wpA[2].find((w) => s1[2].includes(w));
    const pick = (cat, level, must) => {
      const pool = shuffle(cat[2].filter((w) => !used.has(w) && w !== must), r);
      const words = (must ? [must, ...pool] : pool).filter((w) => !used.has(w)).slice(0, 4);
      if (words.length < 4) return false; words.forEach((w) => used.add(w)); groups.push({ level, category: cat[1], words }); return true;
    };
    // herring word goes to the wordplay group; surface group must not contain it
    used.add(herring);
    if (!pick(s1, 0) || !pick(s2, 1)) continue; used.delete(herring);
    if (!pick(wpB, 2) || !pick(wpA, 3, herring)) continue;
    // reject unintended ambiguity: a word fitting two chosen groups' full lists, other than the herring
    const chosen = [s1, s2, wpB, wpA]; let amb = false;
    for (const g of groups) for (const w of g.words) if (w !== herring && chosen.filter((c) => c[2].includes(w)).length > 1) amb = true;
    if (amb || new Set(groups.flatMap((g) => g.words)).size !== 16) continue;
    return { groups, herrings: `${herring} looks like ${s1[1]} but belongs to ${wpA[1]}` };
  }
  throw new Error("hard puzzle failed for seed " + seed);
}
