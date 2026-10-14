import answers from "../data/wordle-answers.json";
export const ANSWERS = answers as string[];
export type Mark = "correct" | "present" | "absent";
export function score(guess: string, answer: string): Mark[] {
  const res: Mark[] = Array(5).fill("absent"); const counts: Record<string, number> = {};
  for (let i = 0; i < 5; i++) { if (guess[i] === answer[i]) res[i] = "correct"; else counts[answer[i]] = (counts[answer[i]] || 0) + 1; }
  for (let i = 0; i < 5; i++) if (res[i] !== "correct" && counts[guess[i]]) { res[i] = "present"; counts[guess[i]]--; }
  return res;
}
