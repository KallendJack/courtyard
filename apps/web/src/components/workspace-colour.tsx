import { WorkspaceColour } from "@courtyard/contract";
import { useId, useState } from "react";
import { classes } from "@/lib/classes";
import { useAction } from "@/lib/use-action";
import { IconButton } from "./button.tsx";
import { FormError } from "./form-error.tsx";

const DOT_CLASS: Record<WorkspaceColour, string> = {
  heather: "bg-workspace-heather",
  bracken: "bg-workspace-bracken",
  slate: "bg-workspace-slate",
  moss: "bg-workspace-moss",
  peat: "bg-workspace-peat",
};

const LABEL: Record<WorkspaceColour, string> = {
  heather: "Heather",
  bracken: "Bracken",
  slate: "Slate",
  moss: "Moss",
  peat: "Peat",
};

/** A workspace's colour dot. */
export function WorkspaceDot(props: { colour: WorkspaceColour; small?: boolean }) {
  return (
    <span
      aria-hidden
      data-workspace-colour={props.colour}
      className={classes(
        "inline-block shrink-0 rounded-full",
        props.small ? "size-2" : "size-2.5",
        DOT_CLASS[props.colour],
      )}
    />
  );
}

/**
 * A workspace's dot, which opens the five colours to choose from. `choose` returns an error to
 * show, or nothing once the colour is kept.
 */
export function ColourChooser(props: {
  colour: WorkspaceColour;
  choose: (colour: WorkspaceColour) => Promise<string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const save = useAction(props.choose);
  const name = useId();

  const choose = async (colour: WorkspaceColour) => {
    if (await save.run(colour)) setOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="-m-1.5 flex">
        <IconButton
          label="Change colour"
          size="xs"
          expanded={open}
          onClick={() => setOpen((was) => !was)}
          icon={<WorkspaceDot colour={props.colour} small />}
        />
      </span>
      {open && (
        <fieldset disabled={save.busy} className="flex items-center gap-1">
          <legend className="sr-only">Colour</legend>
          {WorkspaceColour.options.map((colour) => (
            <label
              key={colour}
              title={LABEL[colour]}
              className="flex size-6 cursor-pointer items-center justify-center rounded-full has-checked:ring-2 has-checked:ring-ring has-focus-visible:outline-2 has-focus-visible:outline-primary-text"
            >
              <input
                type="radio"
                name={name}
                value={colour}
                aria-label={LABEL[colour]}
                checked={colour === props.colour}
                onChange={() => void choose(colour)}
                className="sr-only"
              />
              <WorkspaceDot colour={colour} />
            </label>
          ))}
        </fieldset>
      )}
      {save.error && (
        <div className="basis-full">
          <FormError message={save.error} />
        </div>
      )}
    </div>
  );
}
