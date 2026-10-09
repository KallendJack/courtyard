import {
  ATTACHMENTS,
  type Effort,
  type ModelRef,
  type NewMessage,
  PDF_TYPE,
  type ProviderList,
  type SkillName,
  type SkillSummary,
} from "@courtyard/contract";
import { ArrowUp, Book, Camera, Paperclip, Square } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PdfChip, PhotoThumb } from "@/components/attachment";
import { Button, IconButton } from "@/components/button";
import { Chip } from "@/components/chip";
import { FormError } from "@/components/form-error";
import { Sheet } from "@/components/sheet";
import { SkillChoices, usable } from "@/components/skill-list";
import { matchingSkills, SkillMenu, skillOptionId } from "@/components/skill-menu";
import { SkillTag } from "@/components/skill-tag";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { type Attaching, prepareFiles, releasePreviews } from "./attaching.ts";
import { choiceSummary, ModelPickers, useModelChoice } from "./model-pickers.tsx";
import { availableModels } from "./models.ts";

/** The tallest the skill list grows, and the least room above the box it opens into. */
const LIST_HEIGHT = 448;
const LIST_ROOM_ABOVE = 240;

/** The paperclip's and the camera's names (#78), and what the paperclip says once the tray is full. */
const ATTACH_LABEL = "Attach photos or PDFs";
const CAMERA_LABEL = "Take a photo";
const FULL_HINT = `${ATTACHMENTS.perMessage} is the most a message takes`;

/** A `/` at the start of the box, and what's typed after it: what opens and narrows the skill list. */
const SLASH = /^\/(\S*)$/;

/**
 * A message box with model and effort pickers, and a skill picker when the workspace has skills
 * (ADR 0016). `send` returns an error to show, or nothing on success. Memoised: it doesn't
 * re-render while an answer streams in above it.
 */
export const Composer = memo(function Composer(props: {
  providers: ProviderList["providers"];
  /** The session's last model and effort, which the pickers follow until the owner picks. */
  initialModel?: ModelRef;
  initialEffort?: Effort;
  disabled?: boolean;
  /** While a turn runs: stops it, shown in place of Send. */
  stop?: () => void;
  placeholder: string;
  /** The button's name; "Send" unless the box starts something. */
  submitLabel?: string;
  /**
   * One line with a round button on a narrow screen (a session, where the model carries on), the
   * model and effort in a chip above it that opens a sheet.
   */
  compactOnNarrow?: boolean;
  /** The workspace's skills, to start one with the message, and the workspace's name. */
  skills?: { readonly workspaceName: string; readonly list: readonly SkillSummary[] };
  /** Sends the message with the files attached to it (#78). */
  send: (message: NewMessage, files: readonly File[]) => Promise<string | undefined>;
}) {
  const models = availableModels(props.providers);
  const choice = useModelChoice({
    models,
    followModel: props.initialModel,
    followEffort: props.initialEffort,
  });
  const [choosing, setChoosing] = useState<"model" | "skill">();
  const [text, setText] = useState("");
  const [skill, setSkill] = useState<SkillName>();
  /** The skill list, opened with the Skill pill rather than a `/`. */
  const [listOpen, setListOpen] = useState(false);
  /** The `/…` text the owner closed the list on with Escape, so it stays closed until they type. */
  const [dismissed, setDismissed] = useState<string>();
  const [active, setActive] = useState<SkillName>();
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [place, setPlace] = useState<{ side: "above" | "below"; maxHeight: number }>({
    side: "above",
    maxHeight: LIST_HEIGHT,
  });
  const menuId = useId();
  const send = useAction(props.send);
  const [attaching, setAttaching] = useState<readonly Attaching[]>([]);
  /** Photos still being shrunk, so Send waits for them. */
  const [preparing, setPreparing] = useState(0);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const full = attaching.length >= ATTACHMENTS.perMessage;

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
    } finally {
      setPreparing((count) => count - 1);
    }
  };
  const remove = (gone: Attaching) => {
    releasePreviews([gone]);
    setAttaching((was) => was.filter((each) => each.key !== gone.key));
  };
  /** Files from a picker, which is emptied so the same file can be picked again. */
  const picked = (input: HTMLInputElement) => {
    const files = [...(input.files ?? [])];
    input.value = "";
    void attach(files);
  };

  const skills = props.skills;
  const slash = SLASH.exec(text)?.[1];
  const menuOpen =
    skills !== undefined && (listOpen || (slash !== undefined && dismissed !== text));
  const shown = menuOpen ? matchingSkills(skills.list, slash ?? "") : [];
  const pickable = shown.filter(usable);
  const highlighted = pickable.find((s) => s.name === active) ?? pickable[0];

  // The list floats above the box, as on a session page, or below it when the box is near the
  // top (a workspace page), sized to the room there is.
  useLayoutEffect(() => {
    const rect = form.current?.getBoundingClientRect();
    if (!menuOpen || rect === undefined) return;
    const above = rect.top - 16;
    const below = window.innerHeight - rect.bottom - 16;
    const side = above >= LIST_ROOM_ABOVE || above >= below ? "above" : "below";
    setPlace({ side, maxHeight: Math.min(LIST_HEIGHT, side === "above" ? above : below) });
  }, [menuOpen]);

  const closeList = () => {
    setListOpen(false);
    setActive(undefined);
  };
  const pick = (name: SkillName) => {
    setSkill(name);
    // The `/…` that opened the list was only for finding it.
    if (SLASH.test(text)) setText("");
    setChoosing(undefined);
    closeList();
    box.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { model, effort } = choice;
    if (!model) return send.setError("No model is available. Check the providers' settings.");
    if (text.trim() === "") return;
    const message = {
      text,
      model: model.ref,
      ...(effort === undefined ? {} : { effort }),
      ...(skill === undefined ? {} : { skill }),
    };
    if (
      await send.run(
        message,
        attaching.map((each) => each.file),
      )
    ) {
      setText("");
      setSkill(undefined);
      releasePreviews(attaching);
      setAttaching([]);
    }
  };

  /** Arrows move through the skill list, Enter picks, Escape closes it. */
  const onListKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissed(text);
      closeList();
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (pickable.length === 0) return true;
      const at = highlighted === undefined ? -1 : pickable.indexOf(highlighted);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(pickable[(at + step + pickable.length) % pickable.length]?.name);
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && highlighted !== undefined) {
      event.preventDefault();
      pick(highlighted.name);
      return true;
    }
    return false;
  };

  const label = props.stop ? "Stop" : (props.submitLabel ?? "Send");
  // On a narrow screen a session's box is one line with a round button, and the chip above it
  // opens the pickers in a sheet; beside the box they're there from tablet width up.
  const compact = props.compactOnNarrow === true;

  return (
    <div className="flex flex-col gap-1.5">
      {compact && (
        <>
          <div className="flex items-center gap-2 md:hidden">
            <Chip onClick={() => setChoosing("model")}>{choiceSummary(choice)}</Chip>
            {skills !== undefined && (
              <Chip
                icon={<Book />}
                open={choosing === "skill"}
                onClick={() => setChoosing("skill")}
              >
                Skill
              </Chip>
            )}
          </div>
          <Sheet
            title="Model for this session"
            open={choosing === "model"}
            onClose={() => setChoosing(undefined)}
          >
            <ModelPickers models={models} choice={choice} look="field" />
          </Sheet>
          {skills !== undefined && (
            <Sheet
              title="Use a skill"
              open={choosing === "skill"}
              onClose={() => setChoosing(undefined)}
            >
              <SkillChoices skills={skills.list} pick={pick} />
            </Sheet>
          )}
        </>
      )}
      <div className="relative">
        <input
          ref={picker}
          type="file"
          accept={`image/*,${PDF_TYPE}`}
          multiple
          hidden
          tabIndex={-1}
          onChange={(event) => picked(event.currentTarget)}
        />
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          tabIndex={-1}
          onChange={(event) => picked(event.currentTarget)}
        />
        <form
          ref={form}
          onSubmit={submit}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) closeList();
          }}
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
            "relative flex flex-col gap-2 rounded-lg border bg-field px-3 pt-2.5 pb-2 shadow-xs focus-within:border-primary-text focus-within:ring-3 focus-within:ring-accent md:px-4 md:pt-3.5 md:pb-3",
            compact &&
              (attaching.length === 0
                ? "max-md:rounded-full max-md:px-1.5 max-md:py-1.5"
                : "max-md:rounded-[22px] max-md:px-1.5 max-md:py-1.5"),
          )}
        >
          {menuOpen && (
            <SkillMenu
              id={menuId}
              workspaceName={skills.workspaceName}
              skills={shown}
              active={highlighted?.name}
              pick={pick}
              place={place}
            />
          )}
          {dragging && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-primary bg-accent text-sm/[18px] font-semibold text-primary-text"
            >
              <Paperclip className="size-5" />
              Drop photos or PDFs to attach
            </div>
          )}
          {attaching.length > 0 && (
            <ul
              aria-label="Attachments"
              className={classes("flex flex-wrap items-center gap-2", compact && "max-md:px-1.5")}
            >
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
          {/* On a phone a session's box is one row: paperclip, camera, the message, Send. */}
          <div
            className={classes(
              "contents",
              compact && "max-md:flex max-md:items-center max-md:gap-1",
            )}
          >
            {compact && (
              <span className="contents md:hidden">
                <IconButton
                  label={ATTACH_LABEL}
                  icon={<Paperclip />}
                  disabled={full}
                  {...(full ? { hint: FULL_HINT } : {})}
                  onClick={() => picker.current?.click()}
                />
                <IconButton
                  label={CAMERA_LABEL}
                  icon={<Camera />}
                  disabled={full}
                  onClick={() => camera.current?.click()}
                />
              </span>
            )}
            {skill !== undefined && (
              <SkillTag
                name={skill}
                look="box"
                iconFromTablet={compact}
                onRemove={() => {
                  setSkill(undefined);
                  box.current?.focus();
                }}
              />
            )}
            <textarea
              ref={box}
              aria-label="Message"
              {...(skills === undefined
                ? {}
                : {
                    // Still the message box to a screen reader, which hears the list it opens.
                    "aria-autocomplete": "list" as const,
                    ...(menuOpen ? { "aria-controls": menuId } : {}),
                    ...(menuOpen && highlighted
                      ? { "aria-activedescendant": skillOptionId(menuId, highlighted.name) }
                      : {}),
                  })}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setDismissed(undefined);
                setActive(undefined);
              }}
              onKeyDown={(event) => {
                if (menuOpen && onListKey(event)) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              // A pasted photo or screenshot attaches (#78); pasted text goes in as usual.
              onPaste={(event) => {
                const files = [...event.clipboardData.files];
                // Text copied with a picture of itself (from a document, say) is pasted as text.
                if (files.length === 0 || event.clipboardData.getData("text/plain") !== "") return;
                event.preventDefault();
                void attach(files);
              }}
              placeholder={props.placeholder}
              rows={1}
              // One line to start, growing with what's typed, so the keyboard keeps its room.
              className="block max-h-48 min-h-6 w-full flex-1 resize-none bg-transparent text-base/6 outline-none field-sizing-content md:min-h-12"
            />
            <div className="flex items-center gap-2">
              <span className={classes("contents", compact && "max-md:hidden")}>
                <IconButton
                  label={ATTACH_LABEL}
                  icon={<Paperclip />}
                  size="action"
                  look="disc"
                  disabled={full}
                  {...(full ? { hint: FULL_HINT } : {})}
                  onClick={() => picker.current?.click()}
                />
                {!compact && (
                  <span className="contents md:hidden">
                    <IconButton
                      label={CAMERA_LABEL}
                      icon={<Camera />}
                      size="action"
                      look="disc"
                      disabled={full}
                      onClick={() => camera.current?.click()}
                    />
                  </span>
                )}
                {full && (
                  <span className="text-xs text-muted-foreground">
                    {attaching.length} of {ATTACHMENTS.perMessage}
                  </span>
                )}
              </span>
              <ModelPickers models={models} choice={choice} look="pill" wideOnly={compact} />
              {skills !== undefined && (
                <Chip
                  icon={<Book />}
                  opens="listbox"
                  open={menuOpen}
                  wideOnly={compact}
                  onClick={() => {
                    if (menuOpen) closeList();
                    else setListOpen(true);
                    box.current?.focus();
                  }}
                >
                  Skill
                </Chip>
              )}
              <span className={classes("flex-1", compact && "max-md:hidden")} />
              <Button
                {...(props.stop
                  ? { variant: "outline", onClick: props.stop }
                  : {
                      type: "submit",
                      disabled: send.busy || preparing > 0 || props.disabled || models.length === 0,
                    })}
                {...(compact
                  ? { narrowIcon: props.stop ? <Square className="fill-current" /> : <ArrowUp /> }
                  : {})}
              >
                {props.stop && <Square className="fill-current" />}
                {label}
              </Button>
            </div>
          </div>
        </form>
      </div>
      {props.providers.flatMap((provider) =>
        provider.available
          ? []
          : [
              <p key={provider.id} className="text-xs text-muted-foreground">
                {provider.label} isn't available: {provider.reason}
              </p>,
            ],
      )}
      <FormError message={send.error} />
    </div>
  );
});
