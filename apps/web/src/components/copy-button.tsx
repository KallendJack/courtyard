import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "./button.tsx";

/** How long a copy button says Copied before it's a copy button again. */
const COPIED_FOR_MS = 2000;

/**
 * Copies text in one tap, then shows a tick and "Copied" for a couple of seconds, which screen
 * readers announce too. Three looks: an icon on its own (Copy answer, under each finished answer),
 * a quiet "Copy" button (in a code block's top bar), and an outlined button reading its label
 * (Copy code, beside a sign-in code). Not on the first load.
 */
export function CopyButton(props: {
  /** What the button is called, for screen readers and on hover: "Copy answer". */
  label: string;
  /** What to copy, read at the moment it's tapped. */
  text: () => string;
  look: "icon" | "labelled" | "outline";
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.text());
    } catch {
      // Without the clipboard (a page served over plain HTTP, say) the text can still be selected.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_FOR_MS);
  };
  const tick = <Check strokeWidth={2.25} />;

  if (props.look !== "icon") {
    const outline = props.look === "outline";
    return (
      <Button
        variant={outline ? "outline" : copied ? "quietPrimary" : "quiet"}
        size="xs"
        aria-label={props.label}
        title={props.label}
        onClick={() => void copy()}
      >
        {!outline && (copied ? tick : <Copy className="size-3.5" />)}
        <span aria-hidden>{copied ? "Copied" : outline ? props.label : "Copy"}</span>
        <span role="status" className="sr-only">
          {copied ? "Copied" : ""}
        </span>
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        label={props.label}
        size="action"
        look={copied ? "done" : "quiet"}
        icon={copied ? tick : <Copy />}
        onClick={() => void copy()}
      />
      <span role="status" className="text-xs font-medium text-primary-text">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}
