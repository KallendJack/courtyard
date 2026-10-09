import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "./button.tsx";

/** How long a copy button says Copied before it's a copy button again. */
const COPIED_FOR_MS = 2000;

/**
 * Copies text in one tap, then shows a tick and "Copied" for a couple of seconds, which screen
 * readers announce too. Copy answer under each finished answer. Not on the first load.
 */
export function CopyButton(props: {
  /** What the button is called, for screen readers and on hover: "Copy answer". */
  label: string;
  /** What to copy, read at the moment it's tapped. */
  text: () => string;
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

  return (
    <div className="flex items-center gap-1.5">
      <IconButton
        label={props.label}
        size="action"
        look={copied ? "done" : "quiet"}
        icon={copied ? <Check strokeWidth={2.25} /> : <Copy />}
        onClick={() => void copy()}
      />
      <span role="status" className="text-xs font-medium text-primary-text">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}
