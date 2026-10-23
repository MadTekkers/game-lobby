// Pure Spy Words helpers (no network) — shared by UI and tests.
export const ERRORS: Record<string, string> = {
  board_word: "That clue is (a form of) a word on the board.", one_word: "Clue must be a single word, letters only.", bad_number: "Pick a number 0–9.",
  not_your_turn: "It's not your turn.", spymaster_taken: "That team already has a spymaster.", seat_taken: "Someone is already sitting there.",
  need_spymaster_red: "Red team needs a spymaster.", need_spymaster_blue: "Blue team needs a spymaster.", need_guesser_red: "Red team needs at least one guesser.",
  need_guesser_blue: "Blue team needs at least one guesser.", need_two: "Both agent seats must be filled.", not_host: "Only the host can do that.",
  game_started: "The game already started.", guess_first: "Make at least one guess first.", already_revealed: "Already revealed.",
  already_neutral: "Already known to be a bystander on that key.", name_taken: "Someone with your name is already playing in this game.", no_room: "This room doesn't exist.",
};
export const errText = (m?: string) => (m ? ERRORS[m] || m : "");

/** Client-side mirror of the server clue check (server is authoritative). */
export function clueProblem(word: string, board: string[]): string | null {
  const w = word.trim().toUpperCase();
  if (!w) return "Type a clue.";
  if (!/^[A-Z]{1,24}$/.test(w)) return ERRORS.one_word;
  for (const b of board) if (w === b || [b + "S", b + "ES", b + "ED", b + "ING", b + "ER"].includes(w) || b === w + "S" || b === w + "ES") return ERRORS.board_word;
  return null;
}
