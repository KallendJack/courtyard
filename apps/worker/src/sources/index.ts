import { SOURCES_MAX, Source } from "@courtyard/contract";

/**
 * Sources (ADR 0019): the web pages an answer used, worked out the same way for every provider
 * from the links the answer wrote and the pages the model read.
 */

/**
 * A web address as a page's key, so the same page written two ways is one: only http and https,
 * without any `#` part. `undefined` for anything that isn't a web page's address.
 */
export const pageKey = (address: string): string | undefined => {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  url.hash = "";
  return url.href;
};

/** A Markdown link, `[text](address "title")`, or an address on its own. */
const MARKDOWN_LINK = /\[([^\]\n]*)\]\(\s*<?(https?:\/\/[^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/gi;
const BARE_ADDRESS = /https?:\/\/[^\s<>()[\]"'`]+/gi;
/** What ends a sentence after an address, rather than being part of it. */
const TRAILING = /[.,;:!?*_]+$/;

/** Every web address in some text, with its link's words when it's a Markdown link, in order. */
export const linksIn = (text: string): { url: string; text: string }[] => {
  const links: { at: number; url: string; text: string }[] = [];
  const rest = text.replace(MARKDOWN_LINK, (whole, words: string, url: string, at: number) => {
    links.push({ at, url, text: words.trim() });
    return " ".repeat(whole.length);
  });
  for (const match of rest.matchAll(BARE_ADDRESS)) {
    links.push({ at: match.index, url: match[0].replace(TRAILING, ""), text: "" });
  }
  return links.sort((a, b) => a.at - b.at).map(({ url, text: words }) => ({ url, text: words }));
};

/** A title's last part, after its last separator: "T-3 Series J-Hooks | Titan Fitness". */
const LAST_PART = /^(.+)\s+[|–—-]\s+(.{2,40})$/;

/** Only a name's letters and digits, lower case, to compare it with a host. */
const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * Whether a title's last part is the site's own name, as its host spells it: "Titan Fitness" for
 * titan.fitness, "Rogue Fitness UK" for roguefitness.com. Not "Black Oxide" for roguefitness.com,
 * which is part of the page's title.
 */
const namesHost = (name: string, host: string) => {
  const letters = bare(name);
  const hostLetters = bare(host);
  const mainLabel = bare(host.split(".").slice(-2, -1)[0] ?? "");
  return (
    letters.length >= 2 &&
    (hostLetters.includes(letters) || (mainLabel.length >= 3 && letters.includes(mainLabel)))
  );
};

/** A page as a source: its site's name from its title when the title ends with it, or its host. */
const sourceOf = (page: { url: string; title: string }): Source | undefined => {
  const key = pageKey(page.url);
  if (key === undefined) return undefined;
  const host = new URL(key).hostname.replace(/^www\./, "");
  const title = page.title.replace(/\s+/g, " ").trim();
  const [, rest, last] = LAST_PART.exec(title) ?? [];
  if (rest !== undefined && last !== undefined && namesHost(last, host)) {
    return Source.parse({ site: last.trim(), title: rest.trim(), url: key });
  }
  // A link whose words are only its address or its host says nothing more.
  const saysMore = title !== "" && pageKey(title) === undefined && title !== host;
  return Source.parse({ site: host, title: saysMore ? title : "", url: key });
};

/**
 * A turn's sources, when it used the web: each page the answer links to, then each page the model
 * read that it doesn't link, once each, with the page's title when a search gave one and the
 * link's words otherwise.
 */
export const turnSources = (turn: {
  readonly answer: string;
  /** The pages the model read, by their address. */
  readonly read: readonly string[];
  /** Page titles from the turn's search results, by page key. */
  readonly titles: ReadonlyMap<string, string>;
}): Source[] => {
  const pages = new Map<string, { url: string; title: string }>();
  const add = (url: string, words: string) => {
    const key = pageKey(url);
    if (key === undefined || pages.has(key)) return;
    pages.set(key, { url: key, title: turn.titles.get(key) ?? words });
  };
  for (const link of linksIn(turn.answer)) add(link.url, link.text);
  for (const url of turn.read) add(url, "");
  return [...pages.values()].flatMap((page) => sourceOf(page) ?? []).slice(0, SOURCES_MAX);
};
