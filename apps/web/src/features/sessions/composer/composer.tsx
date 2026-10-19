import {
  ATTACHMENTS,
  type Effort,
  type ModelRef,
  type NewMessage,
  PDF_TYPE,
  type ProviderId,
  type ProviderList,
  type SkillName,
  type SkillSummary,
} from "@courtyard/contract";
import { ArrowUp, Mic, Paperclip, Plus, Square, X } from "lucide-react";
import {
  type FormEvent,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { Button, IconButton } from "@/components/buttons/button";
import { PdfChip, PhotoThumb } from "@/components/chat/attachment";
import { FormError } from "@/components/forms/form-error";
import { type Listener, useDock, useLayout } from "@/components/frame/handheld";
import { scrollFadeAttributes, useScrollFade } from "@/components/layout/scroller";
import { inPicker, matchingSkills } from "@/components/workspace/skill-list";
import { SkillTag } from "@/components/workspace/skill-tag";
import { useAction } from "@/hooks/use-action";
import { classes } from "@/lib/classes";
import { type Attaching, prepareFiles, releasePreviews } from "./attaching.ts";
import { choiceSummary, modelName, useModelChoice } from "./model-pickers.tsx";
import { availableModels } from "./models.ts";

/**
 * What the box leaves at the page's foot once it's in the frame's dock, below the panel: the gap
 * the page keeps everywhere else, so nothing on the page ends against the panel's edge.
 */
const FOOT_GAP = "h-4 shrink-0";
/**
 * Until it docks on a tablet: the dock's height with the box in it (handheld-frame.css,
 * `[data-dock="tablet"]`: its padding above and below, and the box's least height between), and
 * the foot's gap, so the swap moves nothing (#283).
 */
const DOCK_ROOM = "h-[calc(--spacing(25)+env(safe-area-inset-bottom))] shrink-0";

/** The Handheld frame's Skills and Model sheets (#194), loaded with the box. */
const HandheldChoices = lazy(() => import("./handheld-choices.tsx"));

/** What + says once the tray is full. */
const FULL_HINT = `${ATTACHMENTS.perMessage} is the most a message takes`;

/**
 * Whether a paste is files to attach rather than text (#78). A screenshot comes with no text, and a
 * picture copied from a web page with HTML that's only an `<img>` (and perhaps its address as
 * text): those attach. Word and Excel copy a selection's text with a picture of it, and their HTML
 * has that text: the text is what's meant, so it pastes as text.
 */
const pastesFiles = (clipboard: DataTransfer) => {
  if (clipboard.files.length === 0) return false;
  const html = clipboard.getData("text/html");
  if (html === "") return clipboard.getData("text/plain").trim() === "";
  // Parsed, never shown: a parsed document runs no scripts and loads nothing.
  const words = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return words.trim() === "";
};

/** A `/` at the start of the box, and what's typed after it: what narrows the Skills sheet. */
const SLASH = /^\/(\S*)$/;

/**
 * What shows for now instead of the Reply box (step by step's reading line, #241): in its place in
 * the dock on a tablet, and in the page's foot on the cover screen, where the box opens above the
 * bar with Type. The box keeps what's in it.
 */
export type StandIn = {
  /** What shows, given the way back to the box, with the keyboard in it (Type a reply). */
  readonly line: (typeReply: () => void) => ReactNode;
  /** Told as the box comes back, so the stand-in goes. */
  readonly leave: () => void;
};

/**
 * The Reply box (#251, Paper board "Component · Reply box keeps one shape"), the same on every
 * screen, docked in the Handheld frame: one rounded box that only grows upward with the words, to
 * six lines, then scrolls. + on the left adds a photo or a file; on the right the mic talks, and
 * becomes Send once there's something to send. The model and effort show as quiet text between;
 * they change on the rail's Model, and a skill comes from the rail's Skills or a `/` in the box.
 * While the Talk key listens, ✕ takes the +'s place and ■ and ↑ the mic's, with a thin line
 * under the words; while it answers, Stop. `send` returns an error to show, or nothing on success.
 * Memoised: it doesn't re-render while an answer streams in above it.
 */
export const Composer = memo(function Composer(props: {
  providers: ProviderList["providers"];
  /** The session's last model and effort, which the box follows until the owner picks. */
  initialModel?: ModelRef;
  initialEffort?: Effort;
  disabled?: boolean;
  /** While a turn runs: stops it, shown in place of Send until there's a message to queue (#177). */
  stop?: () => void;
  /** While it runs, what's sent goes into that answer (#252), not the queue. */
  steers?: boolean;
  /**
   * Words to put back in the box, after anything typed, such as a queued message taken back to
   * edit (#252): once for each `key`, then `onDrafted` says they're in.
   */
  draft?: { readonly text: string; readonly key: number };
  onDrafted?: () => void;
  placeholder: string;
  /** The button's name; "Send" unless the box starts something. */
  submitLabel?: string;
  /** The workspace's skills, to start one with the message, and the workspace's name. */
  skills?: { readonly workspaceName: string; readonly list: readonly SkillSummary[] };
  /** Sends the message with the files attached to it (#78). */
  send: (message: NewMessage, files: readonly File[]) => Promise<string | undefined>;
  /** What shows for now in the box's place, while step by step reads aloud (#241). */
  standIn?: StandIn;
  /**
   * What shows above the box, in the page's foot, given the provider the message goes to and a
   * way to switch the box's model: a session's warning before a limit (#66).
   */
  above?: (box: {
    readonly provider: ProviderId | undefined;
    readonly switchTo: (model: ModelRef) => void;
  }) => ReactNode;
}) {
  const models = availableModels(props.providers);
  const choice = useModelChoice({
    providers: props.providers,
    models,
    followModel: props.initialModel,
    followEffort: props.initialEffort,
  });
  const [choosing, setChoosing] = useState<"model" | "skill">();
  const [text, setText] = useState("");
  const [skill, setSkill] = useState<SkillName>();
  const box = useRef<HTMLTextAreaElement>(null);
  // Its words scroll inside it once they're taller than it: the thin thumb and the top fade every
  // scroller has (#420, #469).
  const boxFade = useScrollFade(box, { on: true, end: false, watchChildren: false });
  const measureBox = boxFade.measure;
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again whenever its words change.
  useEffect(measureBox, [text, measureBox]);
  const send = useAction(props.send);
  const [attaching, setAttaching] = useState<readonly Attaching[]>([]);
  /** Photos still being shrunk, so Send waits for them. */
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const full = attaching.length >= ATTACHMENTS.perMessage;
  /** The Handheld frame's place for the box (#193), on every screen (#197). */
  const dock = useDock();
  const layout = useLayout();
  // What the owner says goes in after what's typed when listening starts (#198).
  const textNow = useRef(text);
  textNow.current = text;
  /** What's listening for the box, told once it sends so it stops, or stopped from the box. */
  const dictating = useRef<Listener>(undefined);
  /** The Talk key or the mic listens: the box shows ✕, ■ and ↑ (#206). */
  const [listening, setListening] = useState(false);

  // The tray's thumbnails go with the box.
  const attachingNow = useRef(attaching);
  attachingNow.current = attaching;
  useEffect(() => () => releasePreviews(attachingNow.current), []);

  /** Adds files to the tray (#78), saying in one line what can't go. */
  const attach = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setPreparing((count) => count + 1);
    try {
      const { ready, problems } = await prepareFiles(files, attachingNow.current.length);
      setAttaching((was) => [...was, ...ready]);
      send.setError(problems.length === 0 ? undefined : problems.join(" "));
      // On the cover screen, the box opens to show what's attached (or why it can't be).
      dock?.open();
    } finally {
      setPreparing((count) => count - 1);
    }
  };
  const remove = (gone: Attaching) => {
    releasePreviews([gone]);
    setAttaching((was) => was.filter((each) => each.key !== gone.key));
  };
  /** Files from the picker, which is emptied so the same file can be picked again. */
  const picked = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = "";
    void attach(files);
  };

  const skills = props.skills;
  const pickerSkills = skills?.list.filter(inPicker) ?? [];
  /** Opened by a `/`, the Skills sheet narrows to what's typed after it. */
  const slash = choosing === "skill" ? SLASH.exec(text)?.[1] : undefined;

  const pick = (name: SkillName) => {
    setSkill(name);
    // The `/…` that opened the sheet was only for finding it.
    if (SLASH.test(text)) setText("");
    setChoosing(undefined);
    // Picked from the Skills sheet: the box opens to type in.
    if (dock !== undefined) flushSync(dock.open);
    box.current?.focus();
  };

  // While a `/` has the Skills sheet open, typing goes on narrowing it: the sheet has the
  // keyboard, so its keys come here first. Back past the `/`, or a space, and it's words again.
  const slashing = slash !== undefined;
  const narrowed = slashing ? matchingSkills(pickerSkills, slash) : pickerSkills;
  const narrowNow = useRef({ narrowed, pick });
  narrowNow.current = { narrowed, pick };
  useEffect(() => {
    if (!slashing) return;
    const backToBox = (now: string) => {
      flushSync(() => {
        setText(now);
        setChoosing(undefined);
      });
      box.current?.focus();
    };
    const typed = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      const now = textNow.current;
      if (event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        const less = now.slice(0, -1);
        if (SLASH.test(less)) setText(less);
        else backToBox(less);
        return;
      }
      if (event.key === "Enter") {
        // A skill's own row, focused, picks itself.
        if (event.target instanceof HTMLButtonElement) return;
        const first = narrowNow.current.narrowed.find((each) => each.kind === "usable");
        if (first === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        narrowNow.current.pick(first.name);
        return;
      }
      if (event.key.length !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      const more = now + event.key;
      if (SLASH.test(more)) setText(more);
      else backToBox(more);
    };
    window.addEventListener("keydown", typed, { capture: true });
    return () => window.removeEventListener("keydown", typed, { capture: true });
  }, [slashing]);

  /**
   * Sends `message` with the box's model, effort, skill and attachments, and says whether it went.
   * Once it has, the box empties of what was `typed` for it.
   */
  const sendText = async (message: string, typed: string) => {
    const { model, effort } = choice;
    if (!model) {
      send.setError("No model is available. Check the providers' settings.");
      return false;
    }
    // Its provider is unavailable, and the line under the box says why (#299).
    if (choice.unavailable) return false;
    // Words, attachments or both: a photo or PDF can go on its own (#164).
    if (message.trim() === "" && attaching.length === 0) return false;
    const sent = await send.run(
      {
        text: message,
        model: model.ref,
        ...(effort === undefined ? {} : { effort }),
        ...(skill === undefined ? {} : { skill }),
      },
      attaching.map((each) => each.file),
    );
    if (sent) {
      // Unless the owner has typed the next one meanwhile, as they may while a turn runs (#177).
      setText((now) => (now === typed ? "" : now));
      setSkill(undefined);
      releasePreviews(attaching);
      setAttaching([]);
      dock?.close();
      dictating.current?.stop("sent");
      dictating.current = undefined;
    }
    return sent;
  };

  /** Sending as it is now, for a held key let go (#197), whose box was offered renders ago. */
  const sendNow = useRef(sendText);
  sendNow.current = sendText;

  const { standIn } = props;
  /** Back to the box from its stand-in, while the tap is still the browser's to open the keyboard. */
  const typeReply = () => {
    flushSync(() => {
      standIn?.leave();
      dock?.open();
    });
    box.current?.focus();
  };
  const typeReplyNow = useRef(typeReply);
  typeReplyNow.current = typeReply;
  const standing = standIn !== undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await sendText(text, text);
  };

  // The Handheld frame's Type, Talk, Skills and Model act on this box (#193, #79).
  const model = modelName(choice);
  const hasSkills = skills !== undefined;
  const answering = props.stop !== undefined;
  const steers = answering && props.steers === true;
  // Words taken back to edit go in the box, once each, and it opens to them (#252).
  const { draft, onDrafted } = props;
  const drafted = useRef<number>(undefined);
  useEffect(() => {
    if (draft === undefined || drafted.current === draft.key) return;
    drafted.current = draft.key;
    setText((typed) => (typed.trim() === "" ? draft.text : `${typed.trimEnd()}\n${draft.text}`));
    dock?.open();
    box.current?.focus();
    onDrafted?.();
  }, [draft, dock, onDrafted]);
  useEffect(
    () =>
      dock?.offer({
        focus: () => (standing ? typeReplyNow.current() : box.current?.focus()),
        chooseModel: () => setChoosing("model"),
        ...(hasSkills ? { chooseSkill: () => setChoosing("skill") } : {}),
        model,
        ...(choosing === undefined ? {} : { choosing }),
        answering,
        ...(steers ? { steers: true } : {}),
        dictate: (listener) => {
          const typed = textNow.current;
          dictating.current = listener;
          dock?.open();
          setListening(true);
          /** What's in the box now: what was typed, then what's been heard. */
          let now = typed;
          const put = (words: string) => {
            now =
              words === "" ? typed : typed.trim() === "" ? words : `${typed.trimEnd()} ${words}`;
            setText(now);
          };
          return {
            hear: put,
            drop: () => put(""),
            send: () => void sendNow.current(now, now),
            done: () => {
              if (dictating.current === listener) dictating.current = undefined;
              setListening(false);
            },
          };
        },
      }),
    [dock, model, hasSkills, choosing, answering, steers, standing],
  );

  const label = props.submitLabel ?? "Send";
  const cantSend =
    send.busy ||
    preparing > 0 ||
    props.disabled === true ||
    models.length === 0 ||
    choice.unavailable;
  const somethingToSend = text.trim() !== "" || attaching.length > 0;
  // Each its own button, keyed, so one never fades into another as the box changes.
  const sendButton = (
    <IconButton
      key="send"
      type="submit"
      label={label}
      look="primary"
      size="thumb"
      icon={<ArrowUp aria-hidden strokeWidth={2} />}
      disabled={cantSend}
    />
  );

  // On the cover screen the box opens above the bar, and the model shows on the Model button
  // beside it: the box has no room for it there.
  const quietModel = !listening && layout === "tablet" && models.length > 0;

  const messageBox = (
    <div className="flex flex-col gap-1.5">
      <input
        ref={picker}
        type="file"
        accept={`image/*,${PDF_TYPE}`}
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => picked(event.currentTarget)}
      />
      <form
        onSubmit={submit}
        {...(listening ? { "data-listening": "" } : {})}
        // Photos and PDFs dropped anywhere on the box attach (#78).
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDragLeave={(event) => {
          const into = event.relatedTarget;
          if (!(into instanceof Node && event.currentTarget.contains(into))) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void attach([...event.dataTransfer.files]);
        }}
        className={classes(
          "relative flex flex-col gap-2 rounded-reply border bg-field p-2",
          listening
            ? "border-primary-text"
            : "border-input focus-within:border-primary-text focus-within:ring-3 focus-within:ring-accent",
        )}
      >
        {dragging && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-reply border-stroke border-dashed border-primary bg-accent text-sm/4.5 font-semibold text-primary-text"
          >
            <Paperclip className="size-5" />
            Drop photos or PDFs to attach
          </div>
        )}
        {(attaching.length > 0 || skill !== undefined) && (
          <div className="flex flex-wrap items-center gap-2 px-1.5 pt-1">
            {skill !== undefined && (
              <SkillTag
                name={skill}
                look="box"
                onRemove={() => {
                  setSkill(undefined);
                  box.current?.focus();
                }}
              />
            )}
            {attaching.length > 0 && (
              <ul aria-label="Attachments" className="flex flex-wrap items-center gap-2">
                {attaching.map((each) => (
                  <li key={each.key} className="min-w-0">
                    {each.preview === undefined ? (
                      <PdfChip
                        in="tray"
                        name={each.file.name}
                        size={each.file.size}
                        onRemove={() => remove(each)}
                      />
                    ) : (
                      <PhotoThumb
                        in="tray"
                        src={each.preview}
                        name={each.file.name}
                        onRemove={() => remove(each)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {/* One row in every state: what's at either end changes, the box doesn't (#251). */}
        <div className="flex items-end gap-3">
          {listening ? (
            <IconButton
              label="Throw away what you said"
              look="pressed"
              size="thumb"
              icon={<X aria-hidden strokeWidth={1.8} />}
              onClick={() => dictating.current?.stop("drop")}
            />
          ) : (
            <IconButton
              label="Add a photo or file"
              look="pressed"
              size="thumb"
              icon={<Plus aria-hidden strokeWidth={1.8} />}
              disabled={full}
              {...(full ? { hint: FULL_HINT } : {})}
              onClick={() => picker.current?.click()}
            />
          )}
          <div className="relative flex min-w-0 flex-1 py-2.5">
            <textarea
              ref={box}
              aria-label="Message"
              value={text}
              onChange={(event) => {
                const now = event.target.value;
                setText(now);
                // A `/` in the empty box opens the Skills sheet, which narrows as typing goes on.
                if (hasSkills && now === "/" && textNow.current === "") setChoosing("skill");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              // A pasted photo or screenshot attaches (#78); pasted text goes in as usual.
              onPaste={(event) => {
                if (!pastesFiles(event.clipboardData)) return;
                event.preventDefault();
                void attach([...event.clipboardData.files]);
              }}
              placeholder={props.placeholder}
              rows={1}
              onScroll={measureBox}
              {...scrollFadeAttributes(boxFade)}
              // One line to start, growing upward with the words to six, then scrolling.
              className="scroll-thin block max-h-36 min-h-6 w-full resize-none bg-transparent text-base/6 outline-none field-sizing-content"
            />
            {/* Listening: a thin live line under the words, in the box's padding, so nothing moves. */}
            {listening && (
              <span
                aria-hidden
                className="absolute bottom-1 left-0 h-0.75 w-7/10 rounded-hair bg-primary-text shadow-glow-hair motion-safe:animate-pulse"
              />
            )}
          </div>
          {quietModel && (
            <span className="flex h-11 min-w-0 shrink items-center truncate text-meta text-muted-foreground">
              {choiceSummary(choice)}
            </span>
          )}
          {listening ? (
            <span className="flex shrink-0 gap-2">
              <IconButton
                label="Stop listening"
                look="pressed"
                size="thumb"
                icon={<Square aria-hidden className="size-3.5 fill-current" />}
                onClick={() => dictating.current?.stop("keep")}
              />
              {sendButton}
            </span>
          ) : somethingToSend ? (
            // While a turn runs, what's sent now is queued (#177).
            sendButton
          ) : answering ? (
            <Button key="stop" variant="outline" size="lg" onClick={props.stop}>
              <Square aria-hidden className="size-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <IconButton
              key="talk"
              label="Talk into the box"
              look="pressed"
              size="thumb"
              icon={<Mic aria-hidden strokeWidth={1.8} />}
              disabled={dock === undefined}
              onClick={() => dock?.talk()}
            />
          )}
        </div>
      </form>
      {props.providers.flatMap((provider) =>
        provider.available
          ? []
          : [
              <p key={provider.id} className="text-meta text-muted-foreground">
                {provider.label} isn't available: {provider.reason}
              </p>,
            ],
      )}
      <FormError message={send.error} />
    </div>
  );

  // The box is the frame's: it waits for the dock (#359), shown in the page first, it would move
  // into the dock as the frame arrives, and the keyboard would lose it mid-word. On a tablet,
  // until it docks, its room in the dock is kept here, so the swap moves nothing (#283).
  if (dock === undefined)
    return <div aria-hidden className={layout === "tablet" ? DOCK_ROOM : FOOT_GAP} />;
  const line = standIn?.line(typeReply);
  const docked = line !== undefined && layout === "tablet" ? line : messageBox;
  return (
    <>
      {props.above?.({
        provider: choice.model?.ref.provider,
        // Switching provider lands on its default (#247).
        switchTo: (model) => choice.pickProvider(model.provider),
      })}
      <Suspense fallback={null}>
        <HandheldChoices
          choosing={choosing}
          close={() => setChoosing(undefined)}
          changeModel={() => setChoosing("model")}
          models={models}
          choice={choice}
          skills={skills && { workspaceName: skills.workspaceName, list: narrowed }}
          skill={skill}
          pick={pick}
        />
      </Suspense>
      {createPortal(docked, dock.element)}
      {line !== undefined && layout === "cover" && line}
      <div aria-hidden className={FOOT_GAP} />
    </>
  );
});
