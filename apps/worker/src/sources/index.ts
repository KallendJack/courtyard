import { type Activity, SOURCES_MAX, Source } from "@courtyard/contract";

/**
 * Sources (ADR 0019): the web pages an answer used, worked out the same way for every provider
 * from the links the answer wrote, the pages the model read and, for a provider that gives them,
 * its search results.
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

/** A web page's site as the chat names it when nothing better is known: its host, without "www.". */
const hostOf = (key: string) => new URL(key).hostname.replace(/^www\./, "");

/** A page read, as the activity the chat shows ("Read titan.fitness"), when it's a web page's. */
export const pageRead = (address: string): Extract<Activity, { kind: "page-read" }> | undefined => {
  const key = pageKey(address);
  return key === undefined ? undefined : { kind: "page-read", url: key, site: hostOf(key) };
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

/** The labels a host's own name can sit before: the "co" of screwfix.co.uk. */
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac"]);

/** A host's own name: "screwfix" for www.screwfix.co.uk, "titan" for titan.fitness. */
const mainLabelOf = (host: string) =>
  host
    .split(".")
    .slice(0, -1)
    .filter((label) => label !== "www" && !SECOND_LEVEL.has(label))
    .at(-1) ?? "";

/**
 * Whether a title's last part is the site's own name, as its host spells it: "Titan Fitness" for
 * titan.fitness, "Rogue Fitness UK" for roguefitness.com. Not "Black Oxide" for roguefitness.com,
 * which is part of the page's title.
 */
const namesHost = (name: string, host: string) => {
  const letters = bare(name);
  const hostLetters = bare(host);
  const mainLabel = bare(mainLabelOf(host));
  return (
    letters.length >= 2 &&
    (hostLetters.includes(letters) || (mainLabel.length >= 3 && letters.includes(mainLabel)))
  );
};

/** A page as a source: its site's name from its title when the title ends with it, or its host. */
const sourceOf = (page: SearchHit): Source | undefined => {
  const key = pageKey(page.url);
  if (key === undefined) return undefined;
  const host = hostOf(key);
  const title = page.title.replace(/\s+/g, " ").trim();
  const [, rest, last] = LAST_PART.exec(title) ?? [];
  if (rest !== undefined && last !== undefined && namesHost(last, host)) {
    return Source.parse({ site: last.trim(), title: rest.trim(), url: key });
  }
  // A link whose words are only its address or its host says nothing more.
  const saysMore = title !== "" && pageKey(title) === undefined && title !== host;
  return Source.parse({ site: host, title: saysMore ? title : "", url: key });
};

/** Characters with a meaning in a regular expression. */
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

/** Whether some text has a name in it as a word of its own, in any case. */
const mentions = (text: string, name: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(SPECIAL, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(
    text,
  );

/** Whether an answer names a source's site: "Titan Fitness", or "Screwfix" for screwfix.co.uk. */
const namedIn = (answer: string, source: Source) => {
  const mainLabel = mainLabelOf(new URL(source.url).hostname);
  return mentions(answer, source.site) || (mainLabel.length >= 3 && mentions(answer, mainLabel));
};

/** A page a search gave back. */
export type SearchHit = { readonly url: string; readonly title: string };

/** Every search's results, each one's top results first: the first of each, then the second… */
const topFirst = (searches: readonly (readonly SearchHit[])[]) =>
  Array.from({ length: Math.max(0, ...searches.map((hits) => hits.length)) }, (_, rank) =>
    searches.flatMap((hits) => hits[rank] ?? []),
  ).flat();

/**
 * A turn's sources, when it used the web. First the pages it used: each page the answer links to,
 * then each page the model read that it doesn't link, once each, titled from the search results
 * when they have the page and from the link's words otherwise. When it used none, its search
 * results stand in: the ones whose site the answer names, or else all of them, each search's top
 * results first. At most `SOURCES_MAX`.
 */
export const turnSources = (turn: {
  readonly answer: string;
  /** The pages the model read, by their address. */
  readonly read: readonly string[];
  /** Each search's results, in its order; none from a provider that gives no results list. */
  readonly searches: readonly (readonly SearchHit[])[];
}): Source[] => {
  const results = new Map<string, SearchHit>();
  for (const hit of topFirst(turn.searches)) {
    const key = pageKey(hit.url);
    if (key !== undefined && !results.has(key)) results.set(key, { url: key, title: hit.title });
  }
  const pages = new Map<string, SearchHit>();
  const add = (url: string, words: string) => {
    const key = pageKey(url);
    if (key === undefined || pages.has(key)) return;
    pages.set(key, { url: key, title: results.get(key)?.title ?? words });
  };
  for (const link of linksIn(turn.answer)) add(link.url, link.text);
  for (const url of turn.read) add(url, "");
  const sourcesOf = (found: Iterable<SearchHit>) =>
    [...found].flatMap((page) => sourceOf(page) ?? []);
  const used = sourcesOf(pages.values());
  if (used.length > 0) return used.slice(0, SOURCES_MAX);
  const searched = sourcesOf(results.values());
  const named = searched.filter((source) => namedIn(turn.answer, source));
  return (named.length > 0 ? named : searched).slice(0, SOURCES_MAX);
};
