import type { FrictionReport, WorkspaceSummary } from "@courtyard/contract";

// What Something's off fills in at the tap (#554), before anything loads: the page, the screen's
// size and the part of it the owner last touched.

/** What the sheet marks as its own, so the screen's picture leaves it out. */
export const LEFT_OUT = "data-friction";

/** What the sheet fills in, as the report sends it. */
export type FilledIn = Pick<FrictionReport, "page" | "path" | "size" | "part">;

/** The pages with a name of their own, by path. */
const PAGES: Readonly<Record<string, string>> = {
  "/": "Home",
  "/settings": "Settings",
  "/changes": "Recent changes",
  "/fresh-start": "Fresh start",
  "/new-workspace": "New workspace",
};

/** A workspace's pages beyond its own, by the part of the path after its id. */
const IN_WORKSPACE: Readonly<Record<string, string>> = {
  sessions: "Session",
  documents: "Document",
  things: "Thing",
};

/** The page in a word or two: "Home", "Garage", "Garage · Session". */
export const pageOf = (pathname: string, workspaces: readonly WorkspaceSummary[]) => {
  const named = PAGES[pathname];
  if (named !== undefined) return named;
  const [, first, id, kind] = pathname.split("/");
  const workspace = workspaces.find((each) => each.id === decodeURIComponent(id ?? ""));
  if (first !== "workspaces" || workspace === undefined) return pathname;
  const inside = kind === undefined ? undefined : IN_WORKSPACE[kind];
  return inside === undefined ? workspace.name : `${workspace.name} · ${inside}`;
};

/** The screen by the sizes the boards are drawn at (Cover, Fold open, Desktop), and its own size. */
export const screenOf = (): FrictionReport["size"] => {
  const width = Math.round(window.innerWidth);
  const height = Math.round(window.innerHeight);
  return { device: width < 600 ? "cover" : width < 1280 ? "unfolded" : "desktop", width, height };
};

/** How a size reads on its chip: "Fold open · 950 × 712". */
export const sizeWords = (size: FrictionReport["size"]) =>
  `${{ cover: "Cover", unfolded: "Fold open", desktop: "Desktop" }[size.device]} · ${size.width} × ${size.height}`;

/** The longest a part's name runs. */
const PART_MOST = 40;

/** A name as a chip shows it: on one line, cut short when it's long. */
const short = (text: string | null | undefined) => {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  if (line === "") return undefined;
  return line.length > PART_MOST ? `${line.slice(0, PART_MOST - 1).trimEnd()}…` : line;
};

/** What names a block: the label it gives screen readers, or its heading. */
const nameOf = (element: Element) => {
  const label = short(element.getAttribute("aria-label"));
  if (label !== undefined) return label;
  const by = element.getAttribute("aria-labelledby");
  if (by !== null) return short(document.getElementById(by)?.textContent);
  if (["SECTION", "ARTICLE", "LI", "FORM"].includes(element.tagName)) {
    return short(element.querySelector("h1, h2, h3, h4")?.textContent);
  }
  return undefined;
};

/**
 * The part of the screen the owner last touched, by the name of the nearest block that has one
 * ("Backup line", "Needs you"), or `null` when nothing there is named. The page's own blocks only:
 * the frame and its sheets aren't a part of the page.
 */
export const partOf = (touched: Element | undefined): string | null => {
  for (let at = touched ?? null; at !== null && at !== document.body; at = at.parentElement) {
    if (at.closest("[data-handheld], [data-frame-bottom], dialog") !== null) return null;
    const name = nameOf(at);
    if (name !== undefined) return name;
  }
  return null;
};

/** Everything filled in at the tap. */
export const fillIn = (where: {
  pathname: string;
  search: string;
  workspaces: readonly WorkspaceSummary[];
  touched: Element | undefined;
}): FilledIn => ({
  page: pageOf(where.pathname, where.workspaces),
  path: `${where.pathname}${where.search}`,
  size: screenOf(),
  part: partOf(where.touched),
});
