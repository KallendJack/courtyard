import { ReplyBox } from "@courtyard/ui/reply/reply-box.tsx";
import { type ComponentProps, lazy } from "react";

/** The Handheld frame's Skills and Model sheets (#194), loaded with the box. */
const HandheldChoices = lazy(() => import("./handheld-choices.tsx"));

/** The Reply box (packages/ui), with this app's Skills and Model sheets. */
export const Composer = (props: Omit<ComponentProps<typeof ReplyBox>, "choices">) => (
  <ReplyBox {...props} choices={HandheldChoices} />
);
