import type { ComponentProps } from "react";

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
