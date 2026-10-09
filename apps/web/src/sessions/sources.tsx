import type { Source } from "@courtyard/contract";
import { WebLink } from "@/components/web-link";

/** Text as a Markdown link's words, so brackets in it can't end the link early. */
const linkWords = (text: string) => text.replace(/[[\]\\]/g, "\\$&");

/** An address as a Markdown link's target, in angle brackets when a bracket in it would end it. */
const linkTarget = (url: string) => (/[()]/.test(url) ? `<${url}>` : url);

/** An answer's sources as Markdown, as Copy answer adds them: a numbered list of links. */
export const sourcesAsMarkdown = (sources: readonly Source[]) =>
  [
    "Sources:",
    ...sources.map(
      (source, index) =>
        `${index + 1}. [${linkWords(source.site)}](${linkTarget(source.url)})${source.title === "" ? "" : ` · ${source.title}`}`,
    ),
  ].join("\n");

/**
 * The web pages an answer used, numbered under it (ADR 0019): each site's name as a link that
 * opens the page in a new tab, then the page's title. No site icons are loaded, so no site learns
 * the answer was shown.
 */
export function SourceList(props: { sources: readonly Source[] }) {
  return (
    <div className="flex flex-col gap-1">
      <p aria-hidden className="text-xs font-semibold text-muted-foreground">
        Sources
      </p>
      {/* The answer's own numbered lists' look, whose classes are already in the first load. */}
      <ol
        aria-label="Sources"
        className="flex list-decimal flex-col gap-1 pl-6 marker:font-semibold marker:text-primary-text"
      >
        {props.sources.map((source) => (
          <li key={source.url} className="text-sm/[22px]">
            <span className="block truncate">
              <WebLink href={source.url}>{source.site}</WebLink>
              {source.title !== "" && (
                <span className="text-muted-foreground"> · {source.title}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
