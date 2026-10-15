import type { WorkspaceIcon, WorkspaceMode } from "@courtyard/contract";

/**
 * The words in a workspace's name that suggest each icon (#210), the more particular first, so
 * what a workspace is for wins over where it is ("Garage gym" is a dumbbell) and a sport over its
 * setting ("Mountain biking" is a bicycle). Each is matched as whole words, in any case.
 */
const SUGGESTIONS: readonly (readonly [WorkspaceIcon, RegExp])[] = [
  ["bicycle", /\b(bikes?|biking|bicycles?|cycling|cycle|mtb)\b/],
  ["dumbbell", /\b(gym|fitness|training|workouts?|weights|lifting)\b/],
  ["server", /\b(home)?lab\b|\b(servers?|nas|network(ing)?|self-?host(ing|ed)?)\b/],
  ["garage", /\bgarages?\b/],
  ["music", /\b(music|guitars?|piano|band|songs?|singing)\b/],
  ["camera", /\b(photos?|photography|cameras?|videos?|film(ing)?)\b/],
  ["sprout", /\b(garden(ing)?|allotment|plants?|grow(ing)?|veg)\b/],
  ["mountain", /\b(mountains?|hik(e|es|ing)|climb(ing)?|walks?|walking|trek(king)?|camping)\b/],
  ["wallet", /\b(money|finances?|budget(ing)?|bills|savings?|tax)\b/],
  ["heart", /\b(health|family|wedding|kids|baby|wellbeing|love)\b/],
  ["briefcase", /\b(work|jobs?|office|career|business|clients?)\b/],
  ["wrench", /\b(cars?|vans?|repairs?|fix(ing)?|tools|workshop|diy)\b/],
  ["house", /\b(house|home|flat|renovation|kitchen|bathroom|moving)\b/],
  ["code", /\b(code|coding|apps?|software|dev)\b/],
  ["book", /\b(books?|reading|study|studying|writing|notes|courses?)\b/],
];

/**
 * The icon Courtyard suggests for a workspace called `name`: the first that a word in it suggests,
 * else `code` for a code workspace, else the plain one, `book`. The owner can change it any time.
 */
export const suggestIcon = (name: string, mode: WorkspaceMode): WorkspaceIcon => {
  const words = name.toLowerCase();
  const suggested = SUGGESTIONS.find(([, pattern]) => pattern.test(words));
  if (suggested !== undefined) return suggested[0];
  return mode === "code" ? "code" : "book";
};
