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

/** A title's last part names its site when it's short: "T-3 Series J-Hooks | Titan Fitness". */
const SITE_IN_TITLE = /^(.+?)\s+[|–—-]\s+([^|–—]{2,40})$/;

/** A page as a source: its site's name from its title when the title ends with it, or its host. */
const sourceOf = (page: { url: string; title: string }): Source | undefined => {
  const key = pageKey(page.url);
  if (key === undefined) return undefined;
  const host = new URL(key).hostname.replace(/^www\./, "");
  const title = page.title.replace(/\s+/g, " ").trim();
  const named = SITE_IN_TITLE.exec(title);
  const siteName = named?.[2]?.trim();
  if (named?.[1] && siteName && siteName.split(" ").length <= 5) {
    return Source.parse({ site: siteName, title: named[1].trim(), url: key });
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
