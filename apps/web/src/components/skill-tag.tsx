import { skillTitle } from "@courtyard/contract";
import { Book, X } from "lucide-react";
import { classes } from "@/lib/classes";

const LOOKS = {
  /** On the owner's message in the chat: the skill they started with it. */
  message: { tag: "gap-1.25 bg-field py-0.75 pr-2.5 pl-2", icon: "size-3" },
  /** In the message box, once picked: the skill the message will start, with a way to take it off. */
  box: { tag: "gap-1.5 bg-accent py-1 pr-2 pl-2.5", icon: "size-[13px]" },
} as const;

/**
 * The skill an owner's message starts (ADR 0016), as a small pill: on the message in the chat, or
 * in the message box once picked, where its X takes it off. Not on the first load.
 */
export function SkillTag(props: {
  name: string;
  look: keyof typeof LOOKS;
  /** Takes the skill off the message being written (the box's tag only). */
  onRemove?: () => void;
  /** Without its book on a narrow screen, where the box is one line (Paper's phone board). */
  iconFromTablet?: boolean;
}) {
  const look = LOOKS[props.look];
  const title = skillTitle(props.name);
  return (
    <span
      className={classes(
        "inline-flex w-fit max-w-full min-w-0 shrink-0 items-center self-start rounded-full text-xs/4 font-semibold text-primary-text",
        look.tag,
      )}
    >
      <Book
        aria-hidden
        className={classes("shrink-0", look.icon, props.iconFromTablet && "max-md:hidden")}
      />
      <span className="truncate">
        <span className="sr-only">Skill: </span>
        {title}
      </span>
      {props.onRemove && (
        <button
          type="button"
          aria-label={`Take off the ${title} skill`}
          title={`Take off the ${title} skill`}
          onClick={props.onRemove}
          className="-my-1 inline-flex shrink-0 items-center justify-center rounded-full p-0.5 outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      )}
    </span>
  );
}
