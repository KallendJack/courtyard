import type { ComponentProps } from "react";
import { buttonLook } from "./button.tsx";

/**
 * A link to a web page in an answer or its Sources: opened in a new tab, and telling the page
 * nothing about where it was opened from.
 */
export function WebLink(props: Omit<ComponentProps<"a">, "className" | "target" | "rel">) {
  return (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary-text underline underline-offset-2"
    />
  );
}

/**
 * A link to a web page that looks like a Button, opened in a new tab the same way: an action that
 * takes the owner to another site (Copy, open GitHub).
 */
export function WebButton({
  variant = "primary",
  size = "md",
  ...props
}: Omit<ComponentProps<"a">, "className" | "target" | "rel"> & {
  variant?: Parameters<typeof buttonLook>[0]["variant"];
  size?: Parameters<typeof buttonLook>[0]["size"];
}) {
  return (
    <a {...props} target="_blank" rel="noreferrer" className={buttonLook({ variant, size })} />
  );
}
