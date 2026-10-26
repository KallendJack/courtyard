import type {
  BuildStep,
  DerivedBuild,
  ModelRef,
  NewMessage,
  ProviderList,
} from "@courtyard/contract";
import { MarkdownAnswer } from "@courtyard/ui/answer/markdown.tsx";
import { Button, IconButton } from "@courtyard/ui/buttons/button.tsx";
import { usePress } from "@courtyard/ui/frame/press.ts";
import { canListen, feel, type Listening, listen } from "@courtyard/ui/frame/speech.ts";
import { Scroller } from "@courtyard/ui/layout/scroller.tsx";
import { availableModels, providerDefaults } from "@courtyard/ui/reply/models.ts";
import { Mic, X } from "lucide-react";
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import type { BuildTalk } from "./build-chat.tsx";

/** How long an answer stays over the picture once it has all come, before it gets out of the way. */
const ANSWER_SHOWS_MS = 30_000;

/** How long an answer is waited for, with nothing come and nothing answering, before it's given up. */
const GIVE_UP_MS = 60_000;

/**
 * What was asked at the bench: the message and its photo, what the owner said or did (`said`, as
 * the answer's card shows it), and the last entry before it, so its answer shows.
 */
export type Asked = {
  readonly after: number;
  readonly message: NewMessage;
  readonly files: readonly File[];
  readonly said: string;
};

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
 * Sends what's asked in the Build's chat, telling `asked` after which entry its answer will come,
 * or returns why it couldn't go.
 */
const sendAsked = async (
  talk: BuildTalk,
  ask: Omit<Asked, "after">,
  asked: (asked: Asked) => void,
) => {
  const after = talk.chat?.entries.at(-1)?.seq ?? 0;
  const failed = await talk.send(ask.message, ask.files);
  if (failed === undefined) asked({ ...ask, after });
  return failed;
};

/** What's asked from the bench: the message's text, what was said or done, and any photo. */
export type BenchAsk = { text: string; said: string; files: readonly File[] };

/**
 * Asks `text` in the Build's chat with what was `said` and any photo, from the bench (Is this
 * right?, #793), its answer over the picture as Hold to ask's is; or returns why it couldn't go.
 */
export const askAtTheBench = (talk: BuildTalk, ask: BenchAsk, asked: (asked: Asked) => void) => {
  const model = modelFor(talk.chat?.model, talk.providers);
  if (model === undefined) return Promise.resolve(UNREACHABLE);
  return sendAsked(
    talk,
    { message: { text: ask.text, model }, said: ask.said, files: ask.files },
    asked,
  );
};

/** Words said at any bench, which the browser mishears without a nudge ("plant" for plan, #787). */
const BENCH_WORDS = ["clamp", "clamps", "plan", "cut plan", "buy list", "next step"];

/** What Hold to ask listens out for (#787): the bench's words, and the step's parts, tools and words. */
export const benchPhrases = (derived: DerivedBuild, step: BuildStep | undefined) => [
  ...new Set(
    [
      ...BENCH_WORDS,
      ...(step === undefined
        ? []
        : [
            ...step.parts.map(
              (label) => derived.parts.find((part) => part.label === label)?.name ?? label,
            ),
            ...[...step.tools, ...step.safety, ...step.fixings].map((each) => each.name),
            ...step.words,
          ]),
    ].filter((phrase) => phrase.length > 1),
  ),
];

/**
 * Said and let go with fewer words than this, or ending on a word that leads on ("and"), it waits
 * `CARRY_ON_MS` before it's asked, for a hold that carries on (#787).
 */
const FEW_WORDS = 5;
const CARRY_ON_MS = 3000;
const LEADS_ON = new Set(["and", "but", "or", "so", "if", "because", "then", "the", "a", "to"]);

const joined = (...parts: readonly string[]) =>
  parts
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(" ");

/** Whether what was said sounds unfinished: a few words, or a last word that leads on. */
const unfinished = (said: string) => {
  const words = said.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  return words.length < FEW_WORDS || LEADS_ON.has(words.at(-1) ?? "");
};

/**
 * Hold to ask (#753's boards): the chat behind one button, for dusty hands. Held, it listens,
 * showing what will be sent ("Step 3, Cut and label the timber: …"), through any pause, until
 * it's let go; then it's asked in the Build's chat, and `asked` hears what was asked. Let go on
 * a few words, it waits a moment for Hold to add more (#787). A tap opens the chat to type in, as
 * it does where the browser can't listen, or asks at once what's waiting; a tap and a hold are
 * told apart as Courtyard's Talk does (`usePress`). It listens out for `phrases`. In Plan, Chat
 * sits beside it.
 */
export function HoldToAsk(props: {
  talk: BuildTalk;
  /** What the question is about, said before it: the step. */
  about: string | undefined;
  phrases: readonly string[];
  openChat: () => void;
  asked: (asked: Asked) => void;
  withChat?: boolean;
}) {
  const { talk, about } = props;
  const [heard, setHeard] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const listening = useRef<Listening>(undefined);
  const words = useRef("");
  /** What was said and let go, waiting a moment for more; and that moment. */
  const said = useRef("");
  const carryOn = useRef<number>(undefined);
  const [waiting, setWaiting] = useState(false);
  const press = usePress({ held: () => feel("thump") });

  const ask = async (text: string) => {
    const full = about === undefined ? text : `${about}: ${text}`;
    setProblem(await askAtTheBench(talk, { text: full, said: text, files: [] }, props.asked));
  };
  const latestAsk = useRef(ask);
  latestAsk.current = ask;
  // Gone (Plan opened, say): the microphone goes off, and what was let go is asked, not lost.
  useEffect(
    () => () => {
      listening.current?.cancel();
      window.clearTimeout(carryOn.current);
      if (said.current !== "") void latestAsk.current(said.current);
    },
    [],
  );

  /** What was said is done with: asked now, or, sounding unfinished, after a moment for more. */
  const settle = (text: string, now: boolean) => {
    window.clearTimeout(carryOn.current);
    const waits = text !== "" && !now && unfinished(text);
    said.current = waits ? text : "";
    setWaiting(waits);
    setHeard(waits ? text : undefined);
    if (waits) carryOn.current = window.setTimeout(() => settle(text, true), CARRY_ON_MS);
    else if (text !== "") void ask(text);
  };

  const hold = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canListen() || listening.current !== undefined || event.button !== 0) return;
    press.begin(event);
    // Held again in the moment after a few words: what's said now carries on from them.
    window.clearTimeout(carryOn.current);
    setWaiting(false);
    words.current = "";
    setProblem(undefined);
    setHeard(said.current);
    feel("tick");
    /** This hold's listening, and the words it heard. */
    let mine: Listening | undefined;
    let heardHere = "";
    /** Held again before the browser settled this hold's words: that hold carries on from them. */
    const heldAgain = () => listening.current !== undefined && listening.current !== mine;
    mine = listen(
      {
        heard: (now) => {
          heardHere = now;
          words.current = now;
          setHeard(joined(said.current, now));
        },
        finished: (now) => {
          const text = joined(said.current, now === "" ? heardHere : now);
          if (!heldAgain()) return settle(text, false);
          said.current = text;
          setHeard(joined(text, words.current));
        },
        failed: (why) => {
          if (heldAgain()) return;
          press.cancel();
          listening.current = undefined;
          said.current = "";
          setHeard(undefined);
          setProblem(why);
        },
      },
      props.phrases,
    );
    listening.current = mine;
  };
  const letGo = (event: PointerEvent<HTMLButtonElement>) => {
    const how = press.end(event);
    const now = listening.current;
    if (how === undefined || now === undefined) return;
    listening.current = undefined;
    if (how === "tap" && words.current === "") {
      now.cancel();
      // A tap in the moment after a few words asks them now; otherwise it opens the chat.
      if (said.current !== "") return settle(said.current, true);
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
        {/* Dark, its mic in a violet circle, as the boards have it (#826). */}
        <Button
          variant="outline"
          size="talk"
          held
          onPointerDown={hold}
          onPointerUp={letGo}
          onPointerCancel={() => {
            press.cancel();
            listening.current?.cancel();
            listening.current = undefined;
            // What was let go before waits its moment again; what this hold heard is dropped.
            settle(said.current, false);
          }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={tapped}
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Mic aria-hidden className="size-4" />
          </span>
          {waiting ? "Hold to add more" : heard === undefined ? "Hold to ask" : "Let go to ask"}
        </Button>
        {props.withChat === true && (
          <Button variant="outline" size="lg" onClick={props.openChat}>
            Chat
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The answer to what was asked, a card over the picture (#753; at the bench, #793: "Fabrication ·
 * Asking at the bench: step buttons + answer card · Fold (#793)"): what was asked, then the answer
 * as it comes; once it has all come, it gets out of the way by itself, and × closes it sooner. In
 * Plan, Open chat shows it with everything else said; at the bench the chat is a tap away in Plan.
 * One that fails, or never comes, says so, with Try again, until it's closed.
 */
export function BenchAnswer(props: {
  talk: BuildTalk;
  asked: Asked;
  /** Asked again, by Try again: the answer to wait for now. */
  again: (asked: Asked) => void;
  close: () => void;
  openChat: (() => void) | undefined;
}) {
  const { openChat } = props;
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
    setProblem(await sendAsked(talk, props.asked, props.again));
    setTrying(false);
  };

  return (
    <section
      aria-label="Answer"
      className="flex max-h-full min-h-0 flex-col gap-2 rounded-card border border-primary/35 bg-popover p-4 shadow-raised"
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h3 className="min-w-0 pt-1.5 text-meta text-primary-text">
          You asked: {props.asked.said}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {openChat !== undefined && (
            <Button variant="quietPrimary" size="sm" onClick={openChat}>
              Open chat
            </Button>
          )}
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
