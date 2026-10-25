import type {
  BuildChatEntry,
  BuildSlug,
  BuildChat as Chat,
  NewMessage,
  ProviderList,
  WorkspaceId,
} from "@courtyard/contract";
import { MarkdownAnswer } from "@courtyard/ui/answer/markdown.tsx";
import { DockContext } from "@courtyard/ui/frame/handheld.ts";
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
 * A Build's chat, once for its page (#698, #753): what's been said about it in its project's
 * session, kept fresh the shared way and faster while an answer comes, the models it can answer
 * with, and a way to send. The chat panel or sheet shows it, and Hold to ask sends through it.
 */
export const useBuildChat = (props: {
  workspaceId: WorkspaceId;
  slug: BuildSlug;
  /** What changed the Build, so the page reads it again: a change saved in the chat. */
  onChanged: () => void;
}) => {
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

  // A change saved in the chat changes the Build: the page reads it again.
  const saves = chat?.entries.filter((entry) => entry.from === "build").length;
  const seenSaves = useRef(saves);
  useEffect(() => {
    if (saves !== undefined && seenSaves.current !== undefined && saves !== seenSaves.current)
      onChanged();
    seenSaves.current = saves;
  }, [saves, onChanged]);

  /** Sends a message, and says why when it couldn't go. */
  const send = async (message: NewMessage, files: readonly File[]) => {
    const sent = await sendToChat({ workspaceId, slug }, message, files);
    if (sent.kind === "loaded") {
      setAsked((count) => count + 1);
      return undefined;
    }
    return sent.kind === "failed" ? sent.message : "Can't reach Courtyard's worker. Try again.";
  };

  return { chat, providers, send };
};
export type BuildTalk = ReturnType<typeof useBuildChat>;

/**
 * A Build's chat (#698; #753's chat sheet): what's been said, each change saved, and the Reply
 * box with Talk at its foot. Answers are formatted as Courtyard's session formats them, with the
 * shared pieces, and nothing in it is wider than the chat.
 */
export function BuildChat(props: {
  talk: BuildTalk;
  /** Whether it's on screen: opened, it shows the latest, as a new entry does. */
  showing: boolean;
  placeholder: string;
  /** Words and a photo to put in the Reply box, for the owner to send (#699's photo to check). */
  draft:
    | { readonly text: string; readonly files: readonly File[]; readonly key: number }
    | undefined;
  onDrafted: () => void;
}) {
  const { chat, providers, send } = props.talk;
  const { dock, place } = useChatDock();
  const column = useRef<HTMLElement>(null);
  const said = chat?.entries.length;
  // Opened, or with something new said, it shows the latest; an answer as it grows doesn't move it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: to the latest as something new is said
  useEffect(() => {
    const element = column.current;
    if (props.showing && element !== null) element.scrollTop = element.scrollHeight;
  }, [props.showing, said]);
  return (
    <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      {/* To the panel's edges, so a table can run to them on a phone, as in Courtyard's answers. */}
      <Scroller ref={column} className="-mx-4 flex min-h-0 min-w-0 flex-1 flex-col px-4">
        {chat === undefined ? (
          <PlaceholderRows count={3} />
        ) : chat.entries.length === 0 ? (
          <p className="text-answer text-muted-foreground">
            Ask about the Build, or say what to change.
          </p>
        ) : (
          <ol aria-label="Messages" className="flex min-w-0 flex-col gap-4 pb-2">
            {chat.entries.map((entry) => (
              <li key={entry.seq} className="flex min-w-0 flex-col">
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
            placeholder={props.placeholder}
            {...(props.draft === undefined ? {} : { draft: props.draft })}
            onDrafted={props.onDrafted}
            send={send}
          />
        )}
      </DockContext>
    </section>
  );
}

/** One entry: the owner's words, an answer formatted, or a change the chat saved. */
function Entry(props: { entry: BuildChatEntry }) {
  const { entry } = props;
  switch (entry.from) {
    case "owner":
      return (
        <p className="ml-6 self-end rounded-bubble bg-muted px-3.5 py-2.5 text-message whitespace-pre-wrap wrap-anywhere text-foreground">
          {entry.text}
        </p>
      );
    case "model":
      return <MarkdownAnswer text={entry.text} className="text-answer text-foreground/95" />;
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
