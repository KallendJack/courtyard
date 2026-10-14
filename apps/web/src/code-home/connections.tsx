import type { PaperFile, WorkspaceConnections, WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { type RefObject, useEffect, useId, useState } from "react";
import { Button, IconButton } from "@/components/button";
import { GitHubMark, PaperMark } from "@/components/connections-line";
import { FormError } from "@/components/form-error";
import { RadioRow } from "@/components/radio-row";
import { useDialog } from "@/components/use-dialog";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { connectPaper, loadPaperFiles } from "./api.ts";

/** The file Connect connects: one of the owner's, or a new one named after the workspace. */
type Choice = { readonly kind: "file"; readonly file: PaperFile } | { readonly kind: "new" };

/** Names compared as the owner reads them: "Garrett kitchens" is "Garrett Kitchens". */
const sameName = (a: string, b: string) =>
  a.trim().localeCompare(b.trim(), undefined, { sensitivity: "base" }) === 0;

/** The gap the sheet keeps from the screen's edges, as the page's own gutter. */
const GUTTER = 16;
/** The sheet's width where there's room (Paper, "Tablet · Connect Paper"). */
const WIDTH = 440;

/**
 * Where the sheet opens: under the connections line, never past the screen's edge, and no taller
 * than the room below the line, so its foot stays on screen.
 */
const placeUnder = (anchor: HTMLElement | null) => {
  const width = Math.min(WIDTH, window.innerWidth - 2 * GUTTER);
  const box = anchor?.getBoundingClientRect();
  const left = Math.max(GUTTER, Math.min(box?.left ?? GUTTER, window.innerWidth - width - GUTTER));
  const top = (box?.bottom ?? 5 * GUTTER) + 12;
  return { top, left, width, maxHeight: `calc(100dvh - ${top + GUTTER}px)` };
};

/**
 * The Connections sheet (#308; Paper, "Tablet · Connect Paper"): what the workspace's sessions can
 * use. GitHub, through Courtyard's sign-in; and Paper, its one file (ADR 0023), picked from the
 * owner's Paper files with the one named after the workspace picked already, or a new one made,
 * then one Connect. Opened from the connections line, and right after New workspace → Code makes
 * the workspace, where Close skips it.
 */
export function ConnectionsSheet(props: {
  open: boolean;
  onClose: () => void;
  workspaceId: WorkspaceId;
  workspaceName: string;
  connections: WorkspaceConnections;
  onConnected: (connections: WorkspaceConnections) => void;
  anchor: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useDialog(props.open, props.onClose);
  const [place, setPlace] = useState(() => placeUnder(null));
  useEffect(() => {
    if (props.open) setPlace(placeUnder(props.anchor.current));
  }, [props.open, props.anchor]);
  return (
    <dialog
      {...dialog}
      aria-label="Connections"
      style={place}
      className="fixed m-0 overflow-hidden rounded-box border border-input bg-popover p-0 text-popover-foreground shadow-raised backdrop:bg-card/60 open:flex open:flex-col"
    >
      {props.open && <SheetBody {...props} />}
    </dialog>
  );
}

function SheetBody(props: Parameters<typeof ConnectionsSheet>[0]) {
  const { connections, workspaceName } = props;
  const [files, setFiles] = useState<readonly PaperFile[]>();
  const [problem, setProblem] = useState<string>();
  const [choice, setChoice] = useState<Choice>();
  const [asked, setAsked] = useState(0);
  const radios = useId();
  const current = connections.paper.kind === "connected" ? connections.paper.fileId : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again with Try again
  useEffect(() => {
    let showing = true;
    setProblem(undefined);
    void loadPaperFiles(props.workspaceId).then((loaded) => {
      if (!showing) return;
      if (loaded.kind !== "loaded") {
        setProblem(describeProblem(loaded).body);
        return;
      }
      const listed = loaded.data.files;
      setFiles(listed);
      // The file named after the workspace is picked already, else the one it has.
      const picked =
        listed.find((file) => sameName(file.name, workspaceName)) ??
        listed.find((file) => file.id === current);
      setChoice(picked === undefined ? { kind: "new" } : { kind: "file", file: picked });
    });
    return () => {
      showing = false;
    };
  }, [props.workspaceId, asked]);

  const connect = useAction(async () => {
    if (choice === undefined) return undefined;
    const connected = await connectPaper(
      props.workspaceId,
      choice.kind === "new" ? { kind: "new", name: workspaceName } : choice,
    );
    if (connected.kind !== "loaded") return describeProblem(connected).body;
    props.onConnected(connected.data);
    props.onClose();
    return undefined;
  });

  const keeps = choice?.kind === "file" && choice.file.id === current;
  const { github } = connections;
  return (
    // Its title and Connect stay put; only what's between them scrolls (#339).
    <div className="flex min-h-0 flex-col gap-3 p-5">
      <div className="flex shrink-0 items-start justify-between gap-3 pb-1">
        <div className="flex flex-col gap-1">
          <h2 className="display-section text-sheet-title">Connections</h2>
          <p className="text-label/4.5 font-medium text-muted-foreground">
            What this workspace's sessions can use
          </p>
        </div>
        <IconButton label="Close" icon={<X />} onClick={props.onClose} />
      </div>

      <div data-dialog-body="" className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <section
          aria-label="GitHub"
          className="flex items-center gap-3 rounded-bubble bg-secondary px-3.5 py-3"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/85">
            <GitHubMark size={18} />
          </span>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="text-interface font-bold">GitHub</span>
            {github.kind === "connected" ? (
              <span className="truncate text-label font-medium text-success">
                Connected · {github.repo}
              </span>
            ) : github.kind === "signed-out" ? (
              <span className="text-label font-medium text-warning">
                Not connected:{" "}
                <Link to="/settings" hash="connections" className="underline">
                  sign in from Connections
                </Link>
              </span>
            ) : (
              <span className="text-label font-medium text-muted-foreground">
                Its repository isn't on GitHub
              </span>
            )}
          </span>
        </section>

        <fieldset className="flex flex-col gap-2.5 rounded-bubble border border-primary/35 bg-secondary px-3.5 pt-3 pb-3.5">
          <legend className="sr-only">Paper file</legend>
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/85">
              <PaperMark size={18} />
            </span>
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="text-interface font-bold">Paper</span>
              <span className="text-label font-medium text-muted-foreground">
                One file for this workspace's designs
              </span>
            </span>
          </div>
          {problem !== undefined ? (
            <div className="flex flex-col items-start gap-2">
              <FormError message={problem} />
              <Button variant="outline" size="sm" onClick={() => setAsked((was) => was + 1)}>
                Try again
              </Button>
            </div>
          ) : files === undefined ? (
            <p className="text-meta text-muted-foreground">Asking Paper for your files…</p>
          ) : (
            <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto">
              {files.map((file) => (
                <RadioRow
                  key={file.id}
                  name={radios}
                  label={file.name}
                  chosen={choice?.kind === "file" && choice.file.id === file.id}
                  note={sameName(file.name, workspaceName) ? "Same name" : undefined}
                  onChoose={() => setChoice({ kind: "file", file })}
                />
              ))}
              <RadioRow
                name={radios}
                label="Make a new file"
                chosen={choice?.kind === "new"}
                note={choice?.kind === "new" ? `Called ${workspaceName}` : undefined}
                icon={<Plus />}
                onChoose={() => setChoice({ kind: "new" })}
              />
            </div>
          )}
        </fieldset>
      </div>

      <div className="flex shrink-0 flex-col gap-3">
        <Button
          size="lg"
          fullWidth
          disabled={choice === undefined || keeps || connect.busy}
          onClick={() => void connect.run()}
        >
          {choice === undefined
            ? "Connect"
            : choice.kind === "new"
              ? `Make ${workspaceName} and connect it`
              : keeps
                ? `Connected to ${choice.file.name}`
                : `Connect ${choice.file.name}`}
        </Button>
        <FormError message={connect.error} />
      </div>
    </div>
  );
}
