import type { PinnedPart, ThingPin, ThingSlug } from "@courtyard/contract";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { classes } from "@/lib/classes";
import { Button } from "../buttons/button.tsx";

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

/**
 * A Thing's photo with its parts pinned (#481, #565; Paper, "Tablet · Planning Home: the bike, part
 * by part (#565)"), a planning Home's Breakdown view, and safe on the first load (ADR 0012): each
 * part a dot, gold for one that needs something, the chosen one violet. Each pin is a button named
 * "Pin: <part>", marked with its part (`data-pin`) so labels beside the photo can point to it. A
 * tap on a pin chooses it. A mouse drags a pin straight away; a finger holds it first, then drags
 * it, so a tap or a scroll never moves one. Where it's let go is kept at once, while `move` saves
 * it; one that couldn't be saved goes back. While a part with no pin is `placing`, a tap on the
 * photo puts its pin there, the same way.
 */
export function PhotoWithPins(props: {
  src: string;
  alt: string;
  parts: readonly PinnedPart[];
  chosen: ThingSlug | undefined;
  choose: (part: ThingSlug) => void;
  /** Saves a pin where it was let go: whether it was saved. */
  move: (part: ThingSlug, pin: ThingPin) => Promise<boolean>;
  /** A part with no pin yet, which a tap on the photo places. */
  placing?: ThingSlug;
  /**
   * Each placed part's name beside the photo, left or right by where its pin is, with a line to
   * its pin; a tap on one chooses it, as on its pin. Without, the pins alone (the cover screen).
   */
  labelled?: boolean;
  /** Its size and shape, which the layout sets: the photo's, or with labels, theirs and its. */
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

  const pointAt = (event: { readonly clientX: number; readonly clientY: number }) => {
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

  /** Where a part's pin is now: being dragged, just let go, or as the worker has it. */
  const pinNow = (part: PinnedPart) =>
    held?.part === part.thing ? held.pin : (placed.get(part.thing) ?? part.pin ?? undefined);
  // A pin off what shows of the photo (cropped on a wide box) isn't drawn; its label still is.
  const shown =
    frame === undefined
      ? []
      : props.parts.flatMap((part) => {
          const pin = pinNow(part);
          if (pin === undefined) return [];
          const at = placeOf(frame, pin);
          return at.x < 0 || at.y < 0 || at.x > frame.box.width || at.y > frame.box.height
            ? []
            : [{ part, pin, at }];
        });

  const { placing, labelled } = props;
  // Placing a pin is a pointer's: its part's label says how, and a keyboard moves none. A scroll
  // that starts on the photo is cancelled, never let go, so it places nothing.
  const photoBox = (
    <div
      ref={box}
      onPointerUp={(event) => {
        if (placing === undefined || event.target !== photo.current) return;
        const pin = pointAt(event);
        if (pin !== undefined) void letGo(placing, pin);
      }}
      className={classes(
        "relative overflow-hidden bg-muted",
        placing !== undefined && "cursor-crosshair",
        labelled ? "aspect-3/4 h-full shrink-0 rounded-row" : props.className,
      )}
    >
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
      {shown.map(({ part, pin, at }) => (
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
      ))}
    </div>
  );
  if (!labelled) return photoBox;
  return (
    <Labelled
      parts={props.parts}
      pinOf={pinNow}
      shown={shown}
      box={box}
      photoBox={photoBox}
      chosen={props.chosen}
      choose={props.choose}
      className={props.className}
    />
  );
}

type Point = { readonly x: number; readonly y: number };

/** Each label's end nearest the photo, in the labelled box, so a line runs from it to its pin. */
type Ends = ReadonlyMap<ThingSlug, Point>;

const sameEnds = (one: Ends, other: Ends) =>
  one.size === other.size &&
  [...one].every(([part, end]) => {
    const was = other.get(part);
    return was !== undefined && Math.abs(was.x - end.x) < 0.5 && Math.abs(was.y - end.y) < 0.5;
  });

/**
 * The photo with each part's label beside it (#565), those pinned on its left half on the left,
 * the rest on the right, each side in order down the photo so no two lines cross, and those with
 * no pin yet at the foot of the shorter side; and a line from each label to its pin, violet for the
 * chosen one, following a pin as it's dragged.
 */
function Labelled(props: {
  parts: readonly PinnedPart[];
  pinOf: (part: PinnedPart) => ThingPin | undefined;
  /** The pins drawn, where they are in the photo's box. */
  shown: readonly { part: PinnedPart; at: Point }[];
  box: RefObject<HTMLDivElement | null>;
  photoBox: ReactNode;
  chosen: ThingSlug | undefined;
  choose: (part: ThingSlug) => void;
  className: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<ThingSlug, HTMLElement>());
  const [ends, setEnds] = useState<Ends>(new Map());
  /** Where the photo's box is in the labelled box. */
  const [boxAt, setBoxAt] = useState<Point>({ x: 0, y: 0 });

  const down = (part: PinnedPart) => props.pinOf(part)?.y ?? 0;
  const pinned = props.parts.filter((part) => props.pinOf(part) !== undefined);
  const unpinned = props.parts.filter((part) => props.pinOf(part) === undefined);
  const side = (left: boolean) =>
    pinned
      .filter((part) => (props.pinOf(part)?.x ?? 0) < 50 === left)
      .sort((one, other) => down(one) - down(other));
  const onLeft = side(true);
  const onRight = side(false);
  const leftShorter = onLeft.length <= onRight.length;
  const left = leftShorter ? [...onLeft, ...unpinned] : onLeft;
  const right = leftShorter ? onRight : [...onRight, ...unpinned];

  const measure = useCallback(() => {
    const whole = stage.current?.getBoundingClientRect();
    const photo = props.box.current?.getBoundingClientRect();
    if (whole === undefined || photo === undefined) return;
    setBoxAt((was) => {
      const now = { x: photo.left - whole.left, y: photo.top - whole.top };
      return Math.abs(was.x - now.x) < 0.5 && Math.abs(was.y - now.y) < 0.5 ? was : now;
    });
    const now = new Map<ThingSlug, Point>();
    for (const [part, label] of labels.current) {
      const rect = label.getBoundingClientRect();
      const onLeft = rect.right <= photo.left + 1;
      now.set(part, {
        x: (onLeft ? rect.right : rect.left) - whole.left,
        y: rect.top + rect.height / 2 - whole.top,
      });
    }
    setEnds((was) => (sameEnds(was, now) ? was : now));
  }, [props.box]);
  useLayoutEffect(() => {
    const element = stage.current;
    if (element === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure]);
  // Labels come and go, and change sides, as parts are placed and moved.
  useLayoutEffect(measure);

  const label = (part: PinnedPart) => (
    <li
      key={part.thing}
      ref={(element) => {
        if (element === null) labels.current.delete(part.thing);
        else labels.current.set(part.thing, element);
      }}
    >
      <PartLabel part={part} chosen={props.chosen === part.thing} choose={props.choose} />
    </li>
  );
  const column = "flex min-w-0 flex-1 flex-col justify-around gap-2 py-2";
  return (
    <div ref={stage} className={classes("relative flex justify-center gap-6", props.className)}>
      <ul aria-label="Parts on the left" className={classes(column, "items-end")}>
        {left.map(label)}
      </ul>
      {props.photoBox}
      <ul aria-label="Parts on the right" className={classes(column, "items-start")}>
        {right.map(label)}
      </ul>
      <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {props.shown.map(({ part, at }) => {
          const end = ends.get(part.thing);
          if (end === undefined) return null;
          return (
            <line
              key={part.thing}
              x1={end.x}
              y1={end.y}
              x2={boxAt.x + at.x}
              y2={boxAt.y + at.y}
              strokeWidth={props.chosen === part.thing ? 1.5 : 1}
              className={props.chosen === part.thing ? "stroke-primary" : "stroke-foreground/45"}
            />
          );
        })}
      </svg>
    </div>
  );
}

/**
 * A part's label (#565): its name in a pill, with a gold dot when it needs something; filled
 * violet once chosen. Pressed, as its pin is, while its card is open.
 */
function PartLabel(props: {
  part: PinnedPart;
  chosen: boolean;
  choose: (part: ThingSlug) => void;
}) {
  const { part } = props;
  return (
    <Button
      variant={props.chosen ? "primary" : "outline"}
      size="sm"
      aria-pressed={props.chosen}
      onClick={() => props.choose(part.thing)}
    >
      {part.flagged && <span aria-hidden className="size-2 rounded-full bg-warning" />}
      {part.name}
    </Button>
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

/** One pin: a dot in a tap-sized button, gold for a flagged part, violet once chosen. */
function Pin(props: {
  part: PinnedPart;
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

  return (
    <button
      type="button"
      aria-label={`Pin: ${part.name}`}
      aria-pressed={props.chosen}
      data-pin={part.thing}
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

function Disc(props: { part: PinnedPart; chosen: boolean }): ReactNode {
  return (
    <span
      aria-hidden
      className={classes(
        "rounded-full ring-2 ring-card",
        props.chosen
          ? "size-3.5 bg-primary outline-2 outline-offset-2 outline-primary-text"
          : props.part.flagged
            ? "size-3 bg-warning"
            : "size-2.5 bg-foreground",
      )}
    />
  );
}
