// Interactive rules check-in for the Blackjack tutorial: short multiple-choice questions with explanations.
export type RuleQ = { id: string; topic: string; q: string; options: string[]; answer: number; why: string };
export const RULES_QUIZ: RuleQ[] = [
  { id: "values", topic: "Card values", q: "What is a King worth?", options: ["13", "10", "1 or 11"], answer: 1, why: "All face cards (J, Q, K) and tens count 10. Number cards count their pip value." },
  { id: "ace", topic: "Card values", q: "You hold A + 6. What can it count as?", options: ["Only 17", "7 or 17", "Only 7"], answer: 1, why: "An ace counts 11 unless that would bust you, then 1 — so A+6 is \"7 or 17\"." },
  { id: "soft", topic: "Soft vs hard", q: "Which hand is a SOFT 17?", options: ["10 + 7", "A + 6", "9 + 8"], answer: 1, why: "A hand is soft when an ace is counted as 11. Soft hands can't bust on the next card, because the ace can drop to 1." },
  { id: "softhit", topic: "Soft vs hard", q: "You have A + 6 + 9. What is your total?", options: ["Bust (26)", "16", "26 or 16"], answer: 1, why: "The ace drops to 1 to avoid busting: 1 + 6 + 9 = 16 — now a hard 16." },
  { id: "bust", topic: "Bust", q: "You hit 10 + 6 and draw a 7. What happens?", options: ["You lose immediately", "You wait to see if the dealer busts", "It's a push"], answer: 0, why: "Over 21 is a bust and you lose at once — even if the dealer busts later. That's the house's main edge." },
  { id: "dealer", topic: "Dealer rules", q: "At this table, the dealer has soft 17 (A + 6). The dealer must…", options: ["Hit", "Stand", "Choose"], answer: 1, why: "\"Dealer must stand on all 17s\" (S17), including soft 17. The dealer never makes choices: hit 16 or less, stand on 17+." },
  { id: "payout", topic: "Blackjack payout", q: "You bet 20 and are dealt A + K. The dealer has no blackjack. You win…", options: ["20", "30", "40"], answer: 1, why: "A natural blackjack pays 3 to 2: a 20 bet wins 30. Beware 6:5 tables — they pay only 24." },
  { id: "double", topic: "Doubling", q: "When can you double down?", options: ["Any time", "Only on your first two cards", "Only on 10 or 11"], answer: 1, why: "Here you may double on any first two cards (also after a split): you add an equal bet and get exactly one more card." },
  { id: "split", topic: "Splitting", q: "Which hands can be split?", options: ["Two cards of the same value (e.g. 8 + 8, K + 10)", "Any two cards", "Only aces"], answer: 0, why: "Two cards of equal value can be split into two hands, each with its own bet. Split aces get one card each, and A + 10 after a split counts 21, not blackjack." },
  { id: "insurance", topic: "Insurance", q: "The dealer shows an ace and offers insurance. What is it?", options: ["A side bet (half your bet) that the dealer has blackjack, paying 2:1", "A refund if you bust", "Protection against a push"], answer: 0, why: "Insurance pays 2:1 only if the hole card is a ten-value card. Without counting, that happens < 1/3 of the time, so basic strategy declines it." },
  { id: "push", topic: "Ties", q: "You stand on 19 and the dealer also makes 19.", options: ["You lose", "Push — your bet is returned", "You win"], answer: 1, why: "Equal totals are a push. Your bet stays yours." },
];
export const RULES_KEY = "bj_rules_progress";
export type RulesProgress = Record<string, { right: boolean; tries: number }>;
export const loadRules = (): RulesProgress => { try { return JSON.parse(localStorage.getItem(RULES_KEY) || "{}"); } catch { return {}; } };
export const saveRules = (p: RulesProgress) => { try { localStorage.setItem(RULES_KEY, JSON.stringify(p)); } catch { /* private mode */ } };
