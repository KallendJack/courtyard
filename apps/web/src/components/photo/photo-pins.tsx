import type { PinnedPart, ThingPin, ThingSlug } from "@courtyard/contract";
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { classes } from "@/lib/classes";

/** How long a finger holds a pin before it's picked up (#481): a quick tap opens its card. */
const HOLD_MS = 450;
/** How far a finger may wander before a hold counts as a scroll, and a mouse before it drags, in px. */
const SLOP = { touch: 8, mouse: 4 } as const;

type Size = { readonly width: number; readonly height: number };

/**
 * Where the photo is drawn in its box: filling it, cropped at the middle (`object-cover`), so a
 * pin, a percentage of the whole photo, lands where it belongs on what shows.
 */
type Frame = Size & { readonly left: number; readonly top: number; readonly box: Size };

const frameOf = (box: Size, photo: Size): Frame => {
  const scale = Math.max(box.width / photo.width, box.height / photo.height);
  const width = photo.width * scale;
  const height = photo.height * scale;
  return { width, height, left: (box.width - width) / 2, top: (box.height - height) / 2, box };
};

/** A pin's place in the box, in px. */
const placeOf = (frame: Frame, pin: ThingPin) => ({
  x: frame.left + (pin.x / 100) * frame.width,
  y: frame.top + (pin.y / 100) * frame.height,
});

/** Whether two pins are in the same place, as the worker keeps them: to a tenth of a percent. */
const samePlace = (one: ThingPin, other: ThingPin) =>
  Math.abs(one.x - other.x) <= 0.051 && Math.abs(one.y - other.y) <= 0.051;

const within = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** The pin at a point in the box, kept on what shows of the photo. */
const pinAt = (frame: Frame, x: number, y: number): ThingPin => {
  const across = within(x, 0, frame.box.width);
  const down = within(y, 0, frame.box.height);
  return {
    x: within(((across - frame.left) / frame.width) * 100, 0, 100),
    y: within(((down - frame.top) / frame.height) * 100, 0, 100),
  };
};

/** A part on the photo, with its number when it's flagged. */
export type NumberedPart = PinnedPart & { readonly number: number | undefined };

/**
 * A Thing's photo with its parts pinned (#481; Paper, "Tablet · Home: the bike, parts pinned"), a
 * planning Home's picture view, and safe on the first load (ADR 0012):
 * each flagged part a numbered gold pin, the rest faint dots, the chosen one ringed in violet. A
 * tap on a pin chooses it. A mouse drags a pin straight away; a finger holds it first, then drags
 * it, so a tap or a scroll never moves one. Where it's let go is kept at once, while `move` saves it;
 * one that couldn't be saved goes back.
 */
export function PhotoWithPins(props: {
  src: string;
  alt: string;
  parts: readonly NumberedPart[];
  chosen: ThingSlug | undefined;
  choose: (part: ThingSlug) => void;
  /** Saves a pin where it was let go: whether it was saved. */
  move: (part: ThingSlug, pin: ThingPin) => Promise<boolean>;
  /** The box's size and shape, which the layout sets. */
  className: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const [boxSize, setBoxSize] = useState<Size>();
  const [photoSize, setPhotoSize] = useState<Size>();
  /** Pins let go here, kept until the worker's own answer says the same. */
  const [placed, setPlaced] = useState<ReadonlyMap<ThingSlug, ThingPin>>(new Map());
  /** The pin being dragged, where it is now. */
  const [held, setHeld] = useState<{ part: ThingSlug; pin: ThingPin; lifted: boolean }>();

  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) return;
    const measure = () => setBoxSize({ width: element.clientWidth, height: element.clientHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  // Once the worker's answer has a pin where it was let go, that's the one shown.
  useEffect(() => {
    setPlaced((was) => {
      const now = new Map(was);
      for (const part of props.parts) {
        const mine = now.get(part.thing);
        if (mine !== undefined && part.pin !== null && samePlace(mine, part.pin)) {
          now.delete(part.thing);
        }
      }
      return now.size === was.size ? was : now;
    });
  }, [props.parts]);
  // A photo already loaded (from the browser's cache) has no load to wait for.
  useLayoutEffect(() => {
    const image = photo.current;
    if (image?.complete && image.naturalWidth > 0) {
      setPhotoSize({ width: image.naturalWidth, height: image.naturalHeight });
    }
  }, []);

  const frame =
    boxSize === undefined || photoSize === undefined || boxSize.width === 0
      ? undefined
      : frameOf(boxSize, photoSize);

  const pointAt = (event: PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    return frame === undefined || rect === undefined
      ? undefined
      : pinAt(frame, event.clientX - rect.left, event.clientY - rect.top);
  };

  const letGo = async (part: ThingSlug, pin: ThingPin) => {
    setHeld(undefined);
    setPlaced((was) => new Map(was).set(part, pin));
    const saved = await props.move(part, pin);
    if (!saved) {
      setPlaced((was) => {
        const now = new Map(was);
        now.delete(part);
        return now;
      });
    }
  };

  return (
    <div ref={box} className={classes("relative overflow-hidden bg-muted", props.className)}>
      <img
        ref={photo}
        src={props.src}
        alt={props.alt}
        draggable={false}
        onLoad={(event) =>
          setPhotoSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        className="size-full object-cover select-none"
      />
      {frame !== undefined &&
        props.parts.map((part) => {
          const pin =
            held?.part === part.thing
              ? held.pin
              : (placed.get(part.thing) ?? part.pin ?? undefined);
          if (pin === undefined) return null;
          const at = placeOf(frame, pin);
          // A pin off what shows of the photo (cropped on a wide box) isn't drawn; its row still is.
          if (at.x < 0 || at.y < 0 || at.x > frame.box.width || at.y > frame.box.height)
            return null;
          return (
            <Pin
              key={part.thing}
              part={part}
              at={at}
              chosen={props.chosen === part.thing}
              lifted={held?.part === part.thing && held.lifted}
              tap={() => props.choose(part.thing)}
              lift={() => setHeld({ part: part.thing, pin, lifted: true })}
              drag={(event) => {
                const now = pointAt(event);
                if (now !== undefined) setHeld({ part: part.thing, pin: now, lifted: true });
              }}
              drop={(event) => {
                const now = pointAt(event);
                if (now !== undefined) void letGo(part.thing, now);
                else setHeld(undefined);
              }}
              cancel={() => setHeld(undefined)}
            />
          );
        })}
    </div>
  );
}

/** What a pointer on a pin is doing: where it started, and whether it has lifted or moved the pin. */
type Gesture = {
  readonly pointer: number;
  readonly touch: boolean;
  readonly x: number;
  readonly y: number;
  lifted: boolean;
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
};

/** One pin: a numbered gold disc for a flagged part, else a faint dot in a tap-sized button. */
function Pin(props: {
  part: NumberedPart;
  at: { x: number; y: number };
  chosen: boolean;
  lifted: boolean;
  tap: () => void;
  lift: () => void;
  drag: (event: PointerEvent) => void;
  drop: (event: PointerEvent) => void;
  cancel: () => void;
}) {
  const { part } = props;
  const gesture = useRef<Gesture>(undefined);
  const end = () => {
    clearTimeout(gesture.current?.timer);
    gesture.current = undefined;
  };

  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button > 0) return;
    end();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer knows: the pin still follows what reaches it.
    }
    const touch = event.pointerType === "touch";
    const now: Gesture = {
      pointer: event.pointerId,
      touch,
      x: event.clientX,
      y: event.clientY,
      lifted: !touch,
      moved: false,
      timer: undefined,
    };
    if (touch) {
      now.timer = setTimeout(() => {
        now.lifted = true;
        navigator.vibrate?.(10);
        props.lift();
      }, HOLD_MS);
    }
    gesture.current = now;
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const now = gesture.current;
    if (now === undefined || now.pointer !== event.pointerId) return;
    const far = Math.hypot(event.clientX - now.x, event.clientY - now.y);
    if (!now.lifted) {
      // A finger moving before the hold is up is a scroll: the pin stays where it is.
      if (far > SLOP.touch) end();
      return;
    }
    if (now.moved || far > (now.touch ? 0 : SLOP.mouse)) {
      now.moved = true;
      props.drag(event);
    }
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => {
    const now = gesture.current;
    if (now === undefined || now.pointer !== event.pointerId) return;
    end();
    if (now.moved) props.drop(event);
    else {
      props.cancel();
      props.tap();
    }
  };

  const name = part.number === undefined ? part.name : `${part.number}: ${part.name}`;
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={props.chosen}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        end();
        props.cancel();
      }}
      // A key's press (Enter) has no pointer: it chooses it as a tap does.
      onClick={(event) => event.detail === 0 && props.tap()}
      onContextMenu={(event) => event.preventDefault()}
      style={{ left: props.at.x, top: props.at.y }}
      className={classes(
        "absolute flex size-8 -translate-1/2 touch-none items-center justify-center rounded-full outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50",
        props.lifted && "z-10 scale-125",
      )}
    >
      <Disc part={part} chosen={props.chosen} />
    </button>
  );
}

function Disc(props: { part: NumberedPart; chosen: boolean }): ReactNode {
  const ring = props.chosen ? "outline-2 outline-offset-2 outline-primary-text" : "";
  return props.part.number === undefined ? (
    <span
      aria-hidden
      className={classes("size-2.5 rounded-full bg-foreground/70 ring-2 ring-card", ring)}
    />
  ) : (
    <span
      aria-hidden
      className={classes(
        "flex size-6.5 items-center justify-center rounded-full bg-warning text-meta font-extrabold text-card ring-2 ring-card",
        ring,
      )}
    >
      {props.part.number}
    </span>
  );
}
