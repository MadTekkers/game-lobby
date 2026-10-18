// Category-type taxonomy for Connections. Every group gets exactly one type.
export const TYPES = {
  set: "Plain set members (fruits, birds, planets…)",
  trivia: "Trivia & pop culture (films, characters, history)",
  brand: "Brand names",
  jargon: "Sports & game terms",
  people: "Famous people's first/last names",
  synonym: "Synonyms with subtle meanings",
  property: "Things with / things you can … (shared property)",
  compound: "Comes before/after a word (___BALL, FIRE___)",
  phrase: "Fill-in-the-blank phrases (Break the ___)",
  members: "Members of a named set (___ Bowl, ___ Bean)",
  homophone: "Sound-alikes (wordplay)",
  hidden: "Hidden words inside words (wordplay)",
  anagram: "Anagrams (wordplay)",
  letter: "Letter structure: add/remove letters, palindromes, reversals (wordplay)",
};
export const WORDPLAY = new Set(["homophone", "hidden", "anagram", "letter"]);
/** Fallback classifier for labels not tagged in a bank (used to audit legacy puzzles). */
const LEGACY = {
  "Things with keys": "property", "Things with shells": "property", "Things with rings": "property",
  "Famous Johns": "people", "Peter ___": "people", "Poker terms": "jargon", "Sports leagues": "jargon",
  "Beatles": "trivia", "Hogwarts houses": "trivia", "Avengers": "trivia", "Pixar films": "trivia", "Board games": "set", "Capital cities": "set",
  "Seinfeld characters": "trivia", "Mario Kart items": "trivia", "Shakespeare plays": "trivia", "Taylor Swift albums": "trivia", "Greek gods": "trivia",
  "Constellations": "set", "Nobel prize categories": "trivia", "Famous ships": "trivia", "Olympic host cities": "trivia", "Best Picture winners": "trivia",
  "Programming languages named after things": "trivia", "Moons of Jupiter": "trivia", "Apollo-era NASA programs": "trivia", "Disney princesses": "trivia",
  "Friends characters": "trivia", "Star Wars characters": "trivia", "Pokémon": "trivia", "Musicals": "trivia", "Beyoncé albums": "trivia",
  "Ivy League schools": "trivia", "Things named Tesla": "trivia", "Bond films": "trivia", "Famous horses": "trivia",
  "Social apps": "brand", "Car brands": "brand", "Breakfast cereals": "brand", "Famous painters": "people",
};
export function typeOf(label, tagged) {
  if (tagged) return tagged;
  if (LEGACY[label]) return LEGACY[label];
  if (/^Hidden /i.test(label)) return "hidden";
  if (/^Sound(s)? like/i.test(label)) return "homophone";
  if (/^Anagram/i.test(label)) return "anagram";
  if (/^(Add|Remove|Drop|Change) /i.test(label) || /palindrome|backwards|reversed/i.test(label)) return "letter";
  if (/___/.test(label) || /^Words (before|after)/i.test(label)) return "compound";
  return "set";
}
