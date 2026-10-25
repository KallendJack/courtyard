import type { ModelRef, ProviderList } from "@courtyard/contract";
import { MarkdownAnswer } from "@courtyard/ui/answer/markdown.tsx";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { canListen, feel, type Listening, listen } from "@courtyard/ui/frame/speech.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { availableModels, providerDefaults } from "@courtyard/ui/reply/models.ts";
import { Mic, X } from "lucide-react";
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { BuildTalk } from "./build-chat.tsx";

/** A press shorter than this, with nothing heard, is a tap: it opens the chat. */
const TAP_MS = 350;

/** How long an answer stays over the picture once it has all come, before it gets out of the way. */
const ANSWER_SHOWS_MS = 30_000;

/** The model a question goes to: the session's last, or the first default on offer. */
const modelFor = (
  last: ModelRef | undefined,
  providers: ProviderList["providers"] | undefined,
): ModelRef | undefined =>
  last ??
  (providers === undefined
    ? undefined
    : providerDefaults(providers, availableModels(providers))[0]?.model.ref);

/**
 * Hold to ask (#753's boards): the chat behind one button, for dusty hands. Held, it listens,
 * showing what will be sent ("Step 3, Cut and label the timber: …"); let go, it's asked in the
 * Build's chat, and `asked` hears after which entry the answer will come. A tap opens the chat to
 * type in, as it does where the browser can't listen. In Plan, Chat sits beside it.
 */
export function HoldToAsk(props: {
  talk: BuildTalk;
  /** What the question is about, said before it: the step. */
  about: string | undefined;
  openChat: () => void;
  asked: (after: number) => void;
  withChat?: boolean;
}) {
  const { talk, about } = props;
  const [heard, setHeard] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const listening = useRef<Listening>(undefined);
  const words = useRef("");
  const downAt = useRef(0);

  const ask = async (said: string) => {
    const text = said.trim();
    if (text === "") return;
    const model = modelFor(talk.chat?.model, talk.providers);
    if (model === undefined) return setProblem("Can't reach Courtyard's worker. Try again.");
    const after = talk.chat?.entries.at(-1)?.seq ?? 0;
    const failed = await talk.send(
      { text: about === undefined ? text : `${about}: ${text}`, model },
      [],
    );
    if (failed === undefined) props.asked(after);
    else setProblem(failed);
  };

  const hold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canListen() || listening.current !== undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    downAt.current = performance.now();
    words.current = "";
    setProblem(undefined);
    setHeard("");
    feel("thump");
    listening.current = listen({
      heard: (now) => {
        words.current = now;
        setHeard(now);
      },
      finished: (now) => {
        setHeard(undefined);
        void ask(now === "" ? words.current : now);
      },
      failed: (why) => {
        listening.current = undefined;
        setHeard(undefined);
        setProblem(why);
      },
    });
  };
  const letGo = () => {
    const now = listening.current;
    if (now === undefined) return;
    listening.current = undefined;
    if (performance.now() - downAt.current < TAP_MS && words.current === "") {
      now.cancel();
      setHeard(undefined);
      props.openChat();
      return;
    }
    feel("doubleTick");
    now.finish();
  };
  const tapped = (event: MouseEvent) => {
    // A press is handled as it ends; a click from the keyboard, or with no listening, opens the chat.
    if (!canListen() || event.detail === 0) props.openChat();
  };

  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      {heard !== undefined && (
        <p
          role="status"
          className="max-w-sm rounded-row border border-primary/35 bg-popover p-3 text-interface text-foreground shadow-raised"
        >
          {about !== undefined && <span className="text-muted-foreground">{about}: </span>}
          {heard === "" ? <span className="text-muted-foreground">Listening…</span> : heard}
        </p>
      )}
      {problem !== undefined && (
        <p role="status" className="max-w-sm rounded-row bg-popover p-3 text-meta text-warning">
          {problem}
        </p>
      )}
      <div className="flex h-14 items-center rounded-full border border-input bg-popover p-1 shadow-raised">
        <button
          type="button"
          onPointerDown={hold}
          onPointerUp={letGo}
          onPointerCancel={() => {
            listening.current?.cancel();
            listening.current = undefined;
            setHeard(undefined);
          }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={tapped}
          className="flex h-12 touch-none items-center gap-3 rounded-full pr-4 text-interface font-bold text-foreground select-none"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Mic aria-hidden className="size-5" />
          </span>
          {heard === undefined ? "Hold to ask" : "Let go to ask"}
        </button>
        {props.withChat === true && (
          <>
            <span aria-hidden className="h-7 w-px bg-input" />
            <button
              type="button"
              onClick={props.openChat}
              className="h-12 rounded-full px-4 text-interface font-semibold text-primary-text"
            >
              Chat
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The answer to what was asked at the bench, over the picture (#753): it shows as it comes, then,
 * once it has all come, gets out of the way by itself; × closes it sooner, and Open chat shows it
 * with everything else said.
 */
export function BenchAnswer(props: {
  talk: BuildTalk;
  /** The last entry before the question: the answer comes after it. */
  after: number;
  close: () => void;
  openChat: () => void;
}) {
  const { chat } = props.talk;
  const { close } = props;
  const answer = chat?.entries.findLast(
    (entry) => entry.seq > props.after && entry.from === "model",
  );
  const done = answer !== undefined && chat?.answering === false;
  useEffect(() => {
    if (!done) return;
    const away = setTimeout(close, ANSWER_SHOWS_MS);
    return () => clearTimeout(away);
  }, [done, close]);
  return (
    <section
      aria-label="Answer"
      className="flex max-h-full min-h-0 flex-col gap-2 rounded-card border border-primary/35 bg-popover p-4 shadow-raised"
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <CapsLabel tone="primary" heading={{ level: 3 }}>
          Answer
        </CapsLabel>
        <div className="flex items-center gap-1">
          <Button variant="quietPrimary" size="sm" onClick={props.openChat}>
            Open chat
          </Button>
          <IconButton
            label="Close"
            look="quiet"
            size="sm"
            icon={<X aria-hidden />}
            onClick={close}
          />
        </div>
      </div>
      <Scroller className="min-h-0 min-w-0">
        {answer === undefined || answer.from !== "model" ? (
          <p className="text-answer text-muted-foreground motion-safe:animate-pulse">Answering…</p>
        ) : (
          <MarkdownAnswer text={answer.text} className="text-answer text-foreground" />
        )}
      </Scroller>
    </section>
  );
}
