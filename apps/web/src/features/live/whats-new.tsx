import type { WhatsNew } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { useNavigate } from "@tanstack/react-router";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { markWhatsNewSeen } from "./api.ts";

/** What's new, where it is: "New in Garage: Draw the garage". */
const wordsOf = (line: WhatsNew) => {
  switch (line.place.kind) {
    case "workspace":
      return `New in ${line.place.name}: ${line.what}`;
    case "settings":
      return `New in Settings: ${line.what}`;
    case "home":
      return `New: ${line.what}`;
  }
};

/**
 * What's new after an Update (#604; Paper, "Tablet · Home: what's new after an Update (#604)"), in
 * New version's row on Home: Updated, the next line not yet tapped, and Try it, which opens where
 * it's tried (on Home itself, it stays) and says it's been said, so it goes. `onSeen` asks the
 * live status again, for the next line or the row's usual self.
 */
export function WhatsNewRow(props: { line: WhatsNew; onSeen: () => void }) {
  const { line } = props;
  const navigate = useNavigate();
  const tryIt = useAction(async () => {
    // Said once, whether or not the worker heard: the next Update clears it anyway.
    await markWhatsNewSeen(line.pullRequest);
    props.onSeen();
    if (line.place.kind === "workspace") {
      await navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: line.place.id },
      });
    } else if (line.place.kind === "settings") {
      await navigate({ to: "/settings" });
    }
    return undefined;
  });
  return (
    <section
      aria-label="What's new"
      className="flex h-12.5 items-center gap-3.5 rounded-bubble border bg-surface pr-2.5 pl-3.5"
    >
      <CapsLabel tone="muted" inline className="shrink-0 max-sm:hidden">
        Updated
      </CapsLabel>
      <span className="min-w-0 grow truncate text-interface font-bold">{wordsOf(line)}</span>
      <Button onClick={() => void tryIt.run()} busy={tryIt.busy} busyLabel="Opening…">
        Try it
      </Button>
    </section>
  );
}
