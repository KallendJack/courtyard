import type { ReactNode } from "react";
import { addStylesheet } from "@/lib/stylesheet";
import css from "./chat-flow.css?inline";

// The stylesheet of the pieces that keep a session's flow (chat-flow.css), added once, when a page
// showing one of them first loads.
addStylesheet("chat-flow", css);

/**
 * Where the classes of the pieces that keep a session's flow apply (chat-flow.css): around each
 * of them. That stylesheet comes after the theme's, so outside here one of its classes would
 * outrank the theme's screen-size variants on every page. `inline` for one inside a line of text.
 */
export function ChatFlowScope(props: {
  inline?: boolean;
  /** Takes the rest of the row it's in (a session in a list). */
  grows?: boolean;
  children: ReactNode;
}) {
  return props.inline ? (
    <span data-chat-flow="">{props.children}</span>
  ) : (
    <div data-chat-flow="" className={props.grows ? "min-w-0 flex-1" : undefined}>
      {props.children}
    </div>
  );
}
