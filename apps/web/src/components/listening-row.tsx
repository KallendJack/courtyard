import { ArrowUp, Square, X } from "lucide-react";
import { IconButton } from "./button.tsx";

/**
 * Under the words in the Reply box while the Talk key listens (#206, Paper board "Component · Talk
 * key states and listening box", like the Claude app): ✕ throws away what was said and stops
 * listening, a waveform shows it's listening, ■ stops and keeps the words to edit, and ↑ sends
 * them (`send`, the box's own button's name). Only a box docked in the Handheld frame shows it, so
 * it loads with that, and its classes are in the frame's stylesheet (handheld-frame.css).
 */
export default function ListeningRow(props: {
  drop: () => void;
  keep: () => void;
  send: string;
  sendDisabled: boolean;
}) {
  return (
    <div data-handheld="" className="contents">
      <div className="flex items-center gap-3">
        <IconButton
          label="Throw away what you said"
          look="pressed"
          size="thumb"
          icon={<X aria-hidden strokeWidth={1.8} />}
          onClick={props.drop}
        />
        <span className="flex min-w-0 flex-1">
          <Waveform />
        </span>
        <IconButton
          label="Stop listening"
          look="pressed"
          size="thumb"
          icon={<Square aria-hidden className="size-3.5 fill-current" />}
          onClick={props.keep}
        />
        <IconButton
          type="submit"
          label={props.send}
          look="primary"
          size="thumb"
          icon={<ArrowUp aria-hidden strokeWidth={2} />}
          disabled={props.sendDisabled}
        />
      </div>
    </div>
  );
}

/** The waveform's bars, as drawn: what's heard in lilac, then quieter ones still to come. */
const HEARD = [10, 18, 26, 14, 22, 8, 20, 12, 24, 16];
const QUIET = [10, 6, 6];

/** It moves (handheld-frame.css), unless the device asks for less motion. */
function Waveform() {
  return (
    <svg aria-hidden data-talk-bars="" viewBox="0 0 88 28" className="h-7 w-22">
      {[...HEARD, ...QUIET].map((height, at) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: the bars are fixed, a drawing's parts
          key={at}
          x={at * 7}
          y={(28 - height) / 2}
          width="3"
          height={height}
          rx="1.5"
          className={at < HEARD.length ? "fill-primary-text" : "fill-muted-foreground"}
        />
      ))}
    </svg>
  );
}
