import type { BuildStep, DerivedBuild } from "@courtyard/contract";
import { Button } from "@courtyard/ui/buttons/button.tsx";
import { CapsLabel } from "@courtyard/ui/layout/caps-label.tsx";
import { Camera } from "lucide-react";
import { type RefObject, useRef } from "react";
import { CloseUp } from "../close-up.tsx";

/**
 * What "show me how" walks through first (#777): each move in order, numbered, with its close-up
 * where one shows it (the tape's hook, the square's stock).
 */
export function WalkThrough(props: { step: BuildStep; parts: DerivedBuild["parts"] }) {
  if (props.step.walkThrough.length === 0) return null;
  return (
    <section aria-label="How it's done" className="flex flex-col gap-2">
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        How it's done
      </CapsLabel>
      <ol className="flex flex-col gap-3">
        {props.step.walkThrough.map((move, at) => (
          <li key={move.title} className="flex flex-col gap-2">
            <p className="text-answer text-foreground">
              <span className="font-bold">
                {at + 1}. {move.title}:
              </span>{" "}
              {move.says}
            </p>
            {move.closeUp !== null && <CloseUp closeUp={move.closeUp} parts={props.parts} narrow />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The photo picker for a step's check: the camera, on a phone. */
export function PhotoPicker(props: {
  picker: RefObject<HTMLInputElement | null>;
  sendPhoto: (photo: File) => void;
}) {
  return (
    <input
      ref={props.picker}
      type="file"
      accept="image/*"
      capture="environment"
      aria-label="Photo to check"
      className="hidden"
      onChange={(event) => {
        const photo = event.target.files?.[0];
        event.target.value = "";
        if (photo !== undefined) props.sendPhoto(photo);
      }}
    />
  );
}

/**
 * How to know it's right before moving on, and, beside the steps on a computer, a photo of it to
 * the chat to have it checked (at the bench, Is this right? takes the photo, #793).
 */
export function BeforeMovingOn(props: {
  step: BuildStep;
  sendPhoto?: ((photo: File) => void) | undefined;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const { sendPhoto } = props;
  return (
    <section
      aria-label="Before you move on"
      className="flex flex-col gap-2 rounded-card border border-border p-4"
    >
      <CapsLabel tone="muted" heading={{ level: 3 }}>
        Before you move on
      </CapsLabel>
      <p className="text-answer text-foreground">{props.step.check.says}</p>
      {sendPhoto !== undefined && (
        <>
          <div>
            <Button variant="soft" size="md" onClick={() => picker.current?.click()}>
              <Camera aria-hidden />
              Send a photo to check
            </Button>
          </div>
          <PhotoPicker picker={picker} sendPhoto={sendPhoto} />
        </>
      )}
    </section>
  );
}
