import type { Scenario } from "./scenarios.ts";

// The context eval's suggested replies scenarios: a question with a few likely answers comes with
// replies to tap; an answer, or a question only the owner can answer in their own words, has none.

export const REPLIES: readonly Scenario[] = [
  {
    name: "replies-which-day",
    rule: "a question with a few likely answers comes with two or three suggested replies",
    workspace: "Running",
    context: { facts: ["Does a long run once a week, building up to a half marathon in Apr 2027"] },
    turns: [
      {
        say: "Help me pick a day for the weekly long run. Ask me first which days I'm free.",
        expect: [],
        questions: { atLeast: 1, atMost: 2 },
        suggests: true,
      },
    ],
  },
  {
    name: "replies-check-a-plan",
    rule: "checking a plan one question at a time suggests replies to the question",
    workspace: "Garden",
    context: { facts: ["Is painting the shed this weekend"] },
    turns: [
      {
        say: "Check my plan to paint the shed with me, one question at a time.",
        expect: [],
        questions: { atLeast: 1, atMost: 2 },
        suggests: true,
      },
    ],
  },
  {
    name: "replies-none-with-an-answer",
    rule: "an ordinary answer comes with no suggested replies",
    workspace: "Garage gym",
    context: { facts: ["Squat rack bolted to the back wall"] },
    turns: [
      {
        say: "What's a good warm-up before squats? Just the warm-up, please.",
        expect: [],
        suggests: false,
      },
    ],
  },
  {
    name: "replies-none-for-an-open-question",
    rule: "a question only the owner can answer in their own words comes with no suggested replies",
    workspace: "Family",
    context: { facts: ["Is giving a short toast at their sister Amy's wedding on 12 Dec 2026"] },
    turns: [
      {
        say: "Help me write a short toast for Amy's wedding. First, ask me for a favourite memory of her.",
        expect: [],
        questions: { atLeast: 1, atMost: 2 },
        suggests: false,
      },
    ],
  },
];
