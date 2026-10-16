import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/buttons/button";
import { CapsLabel } from "@/components/layout/caps-label";
import { Scroller } from "@/components/layout/scroller";
import { classes } from "@/lib/classes";
import { Answer } from "../sessions/answer/answer.tsx";
import { readDescription } from "./description.ts";

/** Markdown from the description, at body size, all at once. */
const Written = (props: { text: string }) => (
  <Answer text={props.text} running={false} replayed={props.text.length} compact />
);

/**
 * What a pull request changes, in the words the session wrote in its description (#240; Paper,
 * "Tablet · PR review" and "description open"): one line, the first of its Summary, with Read it
 * all; or the whole description, its Summary first, then any other parts, then Evidence and Merge
 * Danger side by side.
 */
export function WhatChanged(props: {
  body: string;
  open: boolean;
  onOpen: (open: boolean) => void;
}) {
  const description = readDescription(props.body);
  const toggle =
    description.summary === "" && description.others.length === 0 ? null : (
      <Button
        variant="outline"
        size="sm"
        aria-expanded={props.open}
        onClick={() => props.onOpen(!props.open)}
      >
        {props.open ? "Show less" : "Read it all"}
        {props.open ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </Button>
    );
  return (
    <section
      aria-label="What changed"
      className={classes(
        "flex shrink-0 flex-col gap-3 rounded-card border bg-surface py-3 pr-3.5 pl-4",
        // Open, from a tablet up, it takes the height the page has left and scrolls inside it,
        // so Merge stays in view (#278).
        props.open && "md:min-h-0 md:shrink md:flex-1",
      )}
    >
      {props.open ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <CapsLabel tone="muted">What changed</CapsLabel>
            {toggle}
          </div>
          <Scroller className="flex min-h-0 flex-col gap-4 pb-1">
            <Written text={description.summary} />
            {description.others.map((part) => (
              <div key={part.heading} className="flex flex-col gap-1">
                {part.heading !== "" && <CapsLabel tone="muted">{part.heading}</CapsLabel>}
                <Written text={part.text} />
              </div>
            ))}
            {(description.evidence !== undefined || description.danger !== undefined) && (
              <div className="grid gap-4 text-foreground/80 md:grid-cols-2 md:gap-3">
                {description.evidence !== undefined && (
                  <div className="flex min-w-0 flex-col gap-1">
                    <CapsLabel tone="muted">Evidence</CapsLabel>
                    <Written text={description.evidence} />
                  </div>
                )}
                {description.danger !== undefined && (
                  <div className="flex min-w-0 flex-col gap-1">
                    <CapsLabel tone="muted">Merge danger</CapsLabel>
                    <Written text={description.danger} />
                  </div>
                )}
              </div>
            )}
          </Scroller>
        </>
      ) : (
        <div className="flex items-center gap-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <CapsLabel tone="muted">What changed</CapsLabel>
            <p className="line-clamp-1 text-interface font-medium wrap-anywhere">
              {description.firstLine || "The session wrote no description."}
            </p>
          </div>
          {toggle}
        </div>
      )}
    </section>
  );
}
