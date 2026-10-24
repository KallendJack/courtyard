/**
 * A milestone's `Build order: #A → #B → #C` line (docs/agents/roadmap.md), also with a note in
 * brackets before its colon, `Build order (owner, 2026-10-21): …` (#687): its list, to a full stop
 * or the line's end, and where that list starts in the description; `null` if it has none.
 */
export const buildOrderLineOf = (description: string) => {
  const line = /build order(?:[ \t]*\([^:.\n]*\))?:(.*?)(?:\.(?=\s|$)|$)/dim.exec(description);
  const at = line?.indices?.[1]?.[0];
  return line === null || at === undefined ? null : { list: line[1] ?? "", at };
};

/** The issue numbers a milestone's description lists on its Build order line, in that order. */
export const buildOrderOf = (description: string | null): readonly number[] => {
  const list = buildOrderLineOf(description ?? "")?.list ?? "";
  return [...list.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
};
