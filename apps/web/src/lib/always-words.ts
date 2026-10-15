import type { AlwaysAllow } from "@courtyard/contract";

/**
 * What Allow always allows (#185), as the approval card and Allowed commands show it: its words,
 * then `…` when more may follow them (`pnpm add …`).
 */
export const alwaysWords = (always: AlwaysAllow) =>
  [...always.words, ...(always.more ? ["…"] : [])].join(" ");
