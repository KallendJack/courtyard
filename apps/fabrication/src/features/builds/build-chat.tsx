import type {
  BuildChatEntry,
  BuildSlug,
  BuildChat as Chat,
  ProviderList,
  WorkspaceId,
} from "@courtyard/contract";
import { DockContext } from "@courtyard/ui/frame/handheld.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { createKept, PlaceholderRows, useKept } from "@courtyard/ui/layout/kept.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { classes } from "@courtyard/ui/lib/classes.ts";
import { ReplyBox } from "@courtyard/ui/reply/reply-box.tsx";
import { Check } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildChat, chatModels, sendToChat } from "@/api/fabrication";
import { useChatDock } from "./chat-dock.ts";

const chats = createKept<Chat>();
const models = createKept<ProviderList["providers"]>();

/** How often the chat asks again while an answer comes. */
const ANSWERING_EVERY_MS = 1500;

/** Fabrication offers no Skills or Model sheet yet: the box follows the session's model. */
const NoChoices = () => null;

/** A change saved in the chat, as its note says it: "Changed: height, castors". */
const savedLine = (entry: Extract<BuildChatEntry, { from: "build" }>) =>
  entry.did === "started" ? "Started the Build" : `Changed: ${entry.changed.join(", ")}`;

/**
 * A Build's chat (#698; Paper, "Fabrication · A Build · Tablet (#698)"): what's been said about
 * it in its project's session, each change it saved, and the Reply box with Talk at its foot.
 * Kept fresh the shared way, faster while an answer comes.
 */
export function BuildChat(props: {
  workspaceId: WorkspaceId;
  slug: BuildSlug;
  /** What changed the Build, so the page reads it again: a change saved in the chat. */
  onChanged: () => void;
}) {
  const { workspaceId, slug, onChanged } = props;
  const [asked, setAsked] = useState(0);
  const chat = useKept(chats, {
    key: `${workspaceId}/${slug}`,
    load: async () => {
      const answer = await buildChat(workspaceId, slug);
      return answer.kind === "loaded" ? answer.data : undefined;
    },
    again: asked,
    busy: (known) => (known.answering ? ANSWERING_EVERY_MS : undefined),
  });
  const providers = useKept(models, {
    key: "models",
    load: async () => {
      const answer = await chatModels();
      return answer.kind === "loaded" ? answer.data.providers : undefined;
    },
  });
  const { dock, place } = useChatDock();

  // A change saved in the chat changes the Build: the page reads it again.
  const saves = chat?.entries.filter((entry) => entry.from === "build").length;
  const seenSaves = useRef(saves);
  useEffect(() => {
    if (saves !== undefined && seenSaves.current !== undefined && saves !== seenSaves.current)
      onChanged();
    seenSaves.current = saves;
  }, [saves, onChanged]);

  const send = async (message: Parameters<typeof sendToChat>[1], files: readonly File[]) => {
    const sent = await sendToChat({ workspaceId, slug }, message, files);
    if (sent.kind === "loaded") {
      setAsked((count) => count + 1);
      return undefined;
    }
    return sent.kind === "failed" ? sent.message : "Can't reach Courtyard's worker. Try again.";
  };

  return (
    <section aria-label="Chat" className="flex min-h-0 flex-1 flex-col gap-3">
      <CapsLabel tone="muted" heading={{ level: 2 }}>
        Chat
      </CapsLabel>
      <Scroller className="flex min-h-0 flex-1 flex-col">
        {chat === undefined ? (
          <PlaceholderRows count={3} />
        ) : chat.entries.length === 0 ? (
          <p className="text-interface text-muted-foreground">
            Ask about the Build, or say what to change.
          </p>
        ) : (
          <ol aria-label="Messages" className="flex flex-col gap-3.5 pb-2">
            {chat.entries.map((entry) => (
              <li key={entry.seq} className="flex flex-col">
                <Entry entry={entry} />
              </li>
            ))}
            {chat.answering && (
              <li className="text-meta text-muted-foreground motion-safe:animate-pulse">
                Answering…
              </li>
            )}
          </ol>
        )}
      </Scroller>
      <div ref={place} className="shrink-0 pt-3" />
      <DockContext value={dock}>
        {providers !== undefined && (
          <ReplyBox
            choices={NoChoices}
            providers={providers}
            {...(chat?.model === undefined ? {} : { initialModel: chat.model })}
            placeholder="Change something…"
            send={send}
          />
        )}
      </DockContext>
    </section>
  );
}

function Entry(props: { entry: BuildChatEntry }) {
  const { entry } = props;
  switch (entry.from) {
    case "owner":
      return (
        <p className="ml-6 self-end rounded-bubble bg-muted px-3.5 py-2.5 text-message whitespace-pre-wrap text-foreground">
          {entry.text}
        </p>
      );
    case "model":
      return (
        <div className="flex flex-col gap-2 text-answer/6 text-foreground/95">
          {entry.text.split(/\n{2,}/).map((paragraph) => (
            <p key={paragraph} className="whitespace-pre-wrap">
              {paragraph}
            </p>
          ))}
        </div>
      );
    case "build":
      return (
        <p
          className={classes(
            "flex items-center gap-2 text-meta text-muted-foreground",
            entry.undone && "line-through",
          )}
        >
          <Check aria-hidden className="size-4 shrink-0 text-success" />
          {savedLine(entry)}
        </p>
      );
  }
}
