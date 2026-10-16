import { createLink } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { buttonLook } from "./button";

/** The anchor a ButtonLink renders: a Button's look on a link. */
function ButtonAnchor({
  variant = "primary",
  size = "md",
  ...props
}: Omit<ComponentProps<"a">, "className"> & {
  variant?: Parameters<typeof buttonLook>[0]["variant"];
  size?: Parameters<typeof buttonLook>[0]["size"];
}) {
  return <a {...props} className={buttonLook({ variant, size })} />;
}

/**
 * A link that looks like a Button, for an action that opens another page (Tidy): it can open in a
 * new tab, and is announced as a link. It takes a Link's `to`, `search` and `params`. In a file
 * of its own, so pages without one don't load it.
 */
export const ButtonLink = createLink(ButtonAnchor);
