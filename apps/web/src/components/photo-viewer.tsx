import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "./button.tsx";

/** How far a swipe goes before it moves to the next photo. */
const SWIPE_PX = 50;

/**
 * A message's photos full size over the page (#78), one at a time: its name and "1 of 2" at the
 * top, a dot for each photo, the arrow keys or a swipe for the next, and X or Escape to close. The
 * browser's own dialog, so Escape, focus and screen readers work as they should.
 */
export function PhotoViewer(props: {
  photos: readonly { readonly src: string; readonly name: string }[];
  /** The photo showing, or `undefined` while the viewer is closed. */
  showing: number | undefined;
  show: (index: number) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipeFrom = useRef<number>(undefined);
  const { photos, showing, show } = props;
  const photo = showing === undefined ? undefined : photos[showing];

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (photo && !element.open) element.showModal();
    if (!photo && element.open) element.close();
  }, [photo]);

  const step = (by: number) => {
    if (showing === undefined || photos.length < 2) return;
    show((showing + by + photos.length) % photos.length);
  };

  return (
    <dialog
      ref={dialog}
      aria-label={photo?.name ?? "Photo"}
      onClose={props.onClose}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
      onPointerDown={(event) => {
        swipeFrom.current = event.clientX;
      }}
      onPointerUp={(event) => {
        const from = swipeFrom.current;
        swipeFrom.current = undefined;
        if (from === undefined || Math.abs(event.clientX - from) < SWIPE_PX) return;
        step(event.clientX < from ? 1 : -1);
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none"
      // Dark in both modes, so a photo stands out; set here, as only this page needs it.
      style={{ backgroundColor: "var(--viewer)", color: "var(--viewer-foreground)" }}
    >
      {photo && showing !== undefined && (
        <div className="relative flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between pt-3 pr-2 pl-5">
            <div className="flex min-w-0 flex-col gap-px">
              <span className="truncate text-sm/[18px] font-medium">{photo.name}</span>
              <span className="text-xs" style={{ color: "var(--viewer-muted)" }}>
                {showing + 1} of {photos.length}
              </span>
            </div>
            <IconButton
              label="Close"
              icon={<X />}
              size="md"
              look="inPill"
              onClick={props.onClose}
            />
          </div>
          <div className="flex min-h-0 grow items-center justify-center pb-14">
            <img
              src={photo.src}
              alt={photo.name}
              className="max-h-full max-w-full object-contain select-none"
              draggable={false}
            />
          </div>
          {photos.length > 1 && (
            <div className="absolute inset-x-0 bottom-9 flex justify-center gap-1.5">
              {photos.map((each, index) => (
                <button
                  key={each.src}
                  type="button"
                  aria-label={`Show ${each.name}`}
                  aria-current={index === showing}
                  onClick={() => show(index)}
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      index === showing ? "var(--viewer-foreground)" : "var(--viewer-dot)",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
