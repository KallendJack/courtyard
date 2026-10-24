import { SESSION_TITLE_MAX_LENGTH } from "@courtyard/contract";
import { TitleAnswer } from "../../prompts/index.ts";

/** Text as a title: its first line, cut short with an ellipsis when it's too long for one. */
export const titleFrom = (text: string) => {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > SESSION_TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, SESSION_TITLE_MAX_LENGTH - 1)}…`
    : firstLine;
};

/**
 * A model's title as the session gets it: on one line, without the quotes or full stop it was
 * told to leave off, and no longer than a title can be. `undefined` when nothing is left.
 */
export const modelTitle = (answer: unknown) => {
  const parsed = TitleAnswer.safeParse(answer);
  if (!parsed.success) return undefined;
  const tidied = parsed.data.title
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/\.$/, "")
    .trim();
  return tidied === "" ? undefined : titleFrom(tidied);
};
