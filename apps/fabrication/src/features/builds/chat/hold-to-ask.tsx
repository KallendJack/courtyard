import type { ModelRef, NewMessage, ProviderList } from "@courtyard/contract";
import { MarkdownAnswer } from "@courtyard/ui/answer/markdown.tsx";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { usePress } from "@courtyard/ui/frame/press.ts";
import { canListen, feel, type Listening, listen } from "@courtyard/ui/frame/speech.ts";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { availableModels, providerDefaults } from "@courtyard/ui/reply/models.ts";
import { Mic, X } from "lucide-react";
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { BuildTalk } from "./build-chat.tsx";

/** How long an answer stays over the picture once it has all come, before it gets out of the way. */
const ANSWER_SHOWS_MS = 30_000;

/** How long an answer is waited for, with nothing come and nothing answering, before it's given up. */
const GIVE_UP_MS = 60_000;

/** What was asked at the bench: the message, and the last entry before it, so its answer shows. */
export type Asked = { readonly after: number; readonly message: NewMessage };

/** Can't reach the worker: why a question didn't go, or Try again didn't. */
const UNREACHABLE = "Can't reach Courtyard's worker. Try again.";

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
 * Sends `message` in the Build's chat, telling `asked` after which entry its answer will come, or
 * returns why it couldn't go.
 */
const sendAsked = async (talk: BuildTalk, message: NewMessage, asked: (asked: Asked) => void) => {
  const after = talk.chat?.entries.at(-1)?.seq ?? 0;
  const failed = await talk.send(message, []);
  if (failed === undefined) asked({ after, message });
  return failed;
};

/**
 * Hold to ask (#753's boards): the chat behind one button, for dusty hands. Held, it listens,
 * showing what will be sent ("Step 3, Cut and label the timber: …"); let go, it's asked in the
 * Build's chat, and `asked` hears what was asked. A tap opens the chat to type in, as it does
 * where the browser can't listen; a tap and a hold are told apart as Courtyard's Talk does
 * (`usePress`). In Plan, Chat sits beside it.
 */
export function HoldToAsk(props: {
  talk: BuildTalk;
  /** What the question is about, said before it: the step. */
  about: string | undefined;
  openChat: () => void;
  asked: (asked: Asked) => void;
  withChat?: boolean;
}) {
  const { talk, about } = props;
  const [heard, setHeard] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const listening = useRef<Listening>(undefined);
  const words = useRef("");
  const press = usePress({ held: () => feel("thump") });

  const ask = async (said: string) => {
    const text = said.trim();
    if (text === "") return;
    const model = modelFor(talk.chat?.model, talk.providers);
    if (model === undefined) return setProblem(UNREACHABLE);
    const message = { text: about === undefined ? text : `${about}: ${text}`, model };
    setProblem(await sendAsked(talk, message, props.asked));
  };

  const hold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canListen() || listening.current !== undefined || event.button !== 0) return;
    press.begin(event);
    words.current = "";
    setProblem(undefined);
    setHeard("");
    feel("tick");
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
        press.cancel();
        listening.current = undefined;
        setHeard(undefined);
        setProblem(why);
      },
    });
  };
  const letGo = (event: PointerEvent<HTMLButtonElement>) => {
    const how = press.end(event);
    const now = listening.current;
    if (how === undefined || now === undefined) return;
    listening.current = undefined;
    if (how === "tap" && words.current === "") {
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
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="thumb"
          held
          onPointerDown={hold}
          onPointerUp={letGo}
          onPointerCancel={() => {
            press.cancel();
            listening.current?.cancel();
            listening.current = undefined;
            setHeard(undefined);
          }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={tapped}
        >
          <Mic aria-hidden className="size-5" />
          {heard === undefined ? "Hold to ask" : "Let go to ask"}
        </Button>
        {props.withChat === true && (
          <Button variant="outline" size="thumb" onClick={props.openChat}>
            Chat
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The answer to what was asked at the bench, over the picture (#753): it shows as it comes, then,
 * once it has all come, gets out of the way by itself; × closes it sooner, and Open chat shows it
 * with everything else said. One that fails, or never comes, says so, with Try again, until it's
 * closed.
 */
export function BenchAnswer(props: {
  talk: BuildTalk;
  asked: Asked;
  /** Asked again, by Try again: the answer to wait for now. */
  again: (asked: Asked) => void;
  close: () => void;
  openChat: () => void;
}) {
  const { talk, close } = props;
  const { after } = props.asked;
  const since = talk.chat?.entries.filter((entry) => entry.seq > after) ?? [];
  const answer = since.findLast((entry) => entry.from === "model");
  const answering = talk.chat?.answering === true;
  // The question reached the chat; with no answer once it's stopped answering, none is coming.
  const reached = since.some((entry) => entry.from === "owner");
  const [waited, setWaited] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [trying, setTrying] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again, it waits afresh
  useEffect(() => {
    setWaited(false);
    const giveUp = setTimeout(() => setWaited(true), GIVE_UP_MS);
    return () => clearTimeout(giveUp);
  }, [after]);
  const failed =
    problem !== undefined || (answer === undefined && !answering && (reached || waited));
  const done = answer !== undefined && !answering;
  useEffect(() => {
    if (!done) return;
    const away = setTimeout(close, ANSWER_SHOWS_MS);
    return () => clearTimeout(away);
  }, [done, close]);

  const tryAgain = async () => {
    setTrying(true);
    setProblem(await sendAsked(talk, props.asked.message, props.again));
    setTrying(false);
  };

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
        {answer !== undefined && answer.from === "model" ? (
          <MarkdownAnswer text={answer.text} className="text-answer text-foreground" />
        ) : failed ? (
          <div className="flex flex-col items-start gap-3">
            <p role="alert" className="text-answer text-destructive-text">
              {problem ?? "It didn't answer."}
            </p>
            <Button
              variant="failedOutline"
              size="sm"
              busy={trying}
              busyLabel="Asking…"
              onClick={() => void tryAgain()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-answer text-muted-foreground motion-safe:animate-pulse">Answering…</p>
        )}
      </Scroller>
    </section>
  );
}
