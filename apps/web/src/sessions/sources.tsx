import type { Source } from "@courtyard/contract";

/** A web page's site as the chat names it: its host, without "www.". */
export const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * The web pages an answer used, numbered under it (ADR 0019): each site's name as a link that
 * opens the page in a new tab, then the page's title. No site icons are loaded, so no site learns
 * the answer was shown.
 */
export function SourceList(props: { sources: readonly Source[] }) {
  return (
    <div className="flex flex-col gap-1 md:gap-1.5">
      <p aria-hidden className="text-xs font-semibold text-muted-foreground">
        Sources
      </p>
      <ol aria-label="Sources" className="flex flex-col gap-1 md:gap-1.5">
        {props.sources.map((source, index) => (
          <li key={source.url} className="flex min-w-0 items-baseline text-sm/5.5">
            <span aria-hidden className="w-5.5 shrink-0 font-semibold text-primary-text">
              {index + 1}.
            </span>
            <span className="min-w-0 truncate">
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary-text underline decoration-1 underline-offset-2"
              >
                {source.site}
              </a>
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
