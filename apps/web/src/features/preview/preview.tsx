import type { Preview, SessionId } from "@courtyard/contract";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { FormError } from "@courtyard/ui/forms/form-error.tsx";
import { useAction } from "@courtyard/ui/hooks/use-action.ts";
import { createKept, useKept } from "@courtyard/ui/layout/kept.tsx";
import { AppWindow, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { WebButton } from "@/components/buttons/web-link";
import { InfoBox } from "@/components/layout/notice";
import { describeProblem } from "../../components/layout/problems.tsx";
import { previewAddress, previewOf, startPreview } from "./api.ts";

/** Each session's preview, as last read. */
const KEPT = createKept<Preview>();

/** How often it's asked again while it may change any moment: starting, or a task running. */
const LIVE_EVERY_MS = 2000;

/**
 * A code session's preview (#183), as the worker has it, kept fresh the shared way: often while
 * it's starting, or while the session runs a task that may yet say where it serves.
 */
export const usePreview = (options: {
  sessionId: SessionId;
  tasksRunning: number;
  /** Whether the session can preview: a code session still taking messages. */
  asking: boolean;
}) => {
  const { sessionId, tasksRunning, asking } = options;
  const preview = useKept(KEPT, {
    key: sessionId,
    asking,
    // Asked again as a task starts or ends.
    again: tasksRunning,
    load: async () => {
      const loaded = await previewOf(sessionId);
      return loaded.kind === "loaded" ? loaded.data : undefined;
    },
    busy: (known) =>
      known.kind === "starting" || (known.kind === "none" && tasksRunning > 0)
        ? LIVE_EVERY_MS
        : undefined,
  });
  const start = async (command: string) => {
    const started = await startPreview(sessionId, command);
    if (started.kind !== "loaded") return describeProblem(started).body;
    KEPT.set(sessionId, started.data);
    return undefined;
  };
  return { preview: asking ? preview : undefined, start };
};

/**
 * The session's Preview button, beside its branch: Preview while one of its tasks serves a page,
 * which opens it; Start preview while none does and Courtyard knows what to run, which runs it
 * (asking the owner to confirm it the first time); nothing while it knows of nothing to run.
 */
export function PreviewButton(props: {
  preview: Preview | undefined;
  /** Opens the preview at its address: beside the chat, or in a tab of its own. */
  onOpen: (address: string) => void;
  /** Start preview, with the command the workspace keeps: an error to show, or nothing. */
  onStart: (command: string) => Promise<string | undefined>;
  /** Start preview, with a command the owner hasn't confirmed yet. */
  onConfirm: () => void;
}) {
  const { preview } = props;
  const starting = useAction(props.onStart);
  if (preview === undefined) return null;
  switch (preview.kind) {
    case "serving":
      return (
        <Button variant="soft" size="sm" onClick={() => props.onOpen(previewAddress(preview.port))}>
          <AppWindow aria-hidden />
          Preview
        </Button>
      );
    case "starting":
      return (
        <Button variant="soft" size="sm" busy busyLabel="Starting preview…">
          <AppWindow aria-hidden />
          Preview
        </Button>
      );
    case "full":
      return (
        <Button variant="soft" size="sm" disabled title="Every preview port is in use">
          <AppWindow aria-hidden />
          Preview
        </Button>
      );
    case "none": {
      const { command } = preview;
      if (command === null) return null;
      return (
        <Button
          variant="outline"
          size="sm"
          busy={starting.busy}
          busyLabel="Starting preview…"
          onClick={() => (preview.confirmed ? void starting.run(command) : props.onConfirm())}
        >
          <AppWindow aria-hidden />
          Start preview
        </Button>
      );
    }
  }
}

/**
 * Start preview the first time (#183): everything Courtyard filled in, the command it'll run, for
 * one tap to confirm, so it runs exactly what the owner sees.
 */
export function ConfirmPreview(props: {
  command: string;
  onStart: (command: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const start = useAction(async () => {
    const problem = await props.onStart(props.command);
    if (problem === undefined) props.onCancel();
    return problem;
  });
  return (
    <InfoBox label="Start preview">
      <div className="flex min-w-0 flex-col gap-3">
        <p>
          Start the preview with <code className="font-mono">{props.command}</code>? It runs as one
          of this session's tasks, and this workspace keeps it for its next previews.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            busy={start.busy}
            busyLabel="Starting preview…"
            onClick={() => void start.run()}
          >
            Start preview
          </Button>
          <Button size="sm" variant="outline" waiting={start.busy} onClick={props.onCancel}>
            Cancel
          </Button>
        </div>
        <FormError message={start.error} />
      </div>
    </InfoBox>
  );
}

/**
 * The preview beside the chat (#183), on the unfolded Fold and a desktop: the app in a frame,
 * with Open in a tab and Close.
 */
export function PreviewPanel(props: { address: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <section
      aria-label="Preview"
      className="flex min-h-0 min-w-0 flex-1 flex-col border-l bg-background"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <p className="min-w-0 truncate font-mono text-meta text-muted-foreground">
          {props.address}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <WebButton variant="quiet" size="xs" href={props.address}>
            <ExternalLink aria-hidden />
            Open in a tab
          </WebButton>
          <IconButton label="Close preview" icon={<X />} onClick={props.onClose} />
        </div>
      </div>
      <iframe
        title="The app"
        src={props.address}
        onLoad={() => setLoaded(true)}
        className={loaded ? "min-h-0 w-full flex-1" : "min-h-0 w-full flex-1 opacity-0"}
      />
    </section>
  );
}
