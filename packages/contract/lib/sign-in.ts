import { z } from "zod";
import { ProviderId } from "./session.ts";

/**
 * Where a provider's sign-in stands, for a provider whose sign-in Courtyard handles (Codex's, ADR
 * 0015). Only the link and one-time code of a sign-in in progress ever reach the browser: the
 * sign-in itself stays in the provider's own home on the worker machine.
 */
export const SignInState = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("signed-in"),
    /** Who is signed in, when the provider says. */
    email: z.string().nullable(),
    /** Their plan, in the provider's word for it ("plus"), when it says. */
    plan: z.string().nullable(),
  }),
  z.object({ kind: z.literal("signed-out") }),
  /** Waiting for the owner to open the link on any device and enter the code. */
  z.object({
    kind: z.literal("waiting"),
    link: z.url({ protocol: /^https$/ }),
    code: z.string(),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  /** The last sign-in didn't finish: its code ran out, or it failed. */
  z.object({ kind: z.literal("not-finished"), why: z.enum(["expired", "failed"]) }),
  /** The provider can't be reached to ask (not installed, say), and why. */
  z.object({ kind: z.literal("unavailable"), reason: z.string() }),
]);
export type SignInState = z.infer<typeof SignInState>;

/** One provider's sign-in, as the home page shows it. */
export const ProviderSignIn = z.object({
  provider: ProviderId,
  label: z.string(),
  /** What the owner signs in to, by name: "ChatGPT". */
  service: z.string(),
  state: SignInState,
  /** Whether the owner said Not now to signing in, so the home page doesn't ask again. */
  notNow: z.boolean(),
});
export type ProviderSignIn = z.infer<typeof ProviderSignIn>;

export const SignInList = z.object({ signIns: z.array(ProviderSignIn) });
export type SignInList = z.infer<typeof SignInList>;
