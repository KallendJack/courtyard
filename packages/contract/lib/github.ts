import { z } from "zod";

/**
 * Where Courtyard's GitHub sign-in stands (#99): Courtyard signs in to GitHub itself, through the
 * GitHub App the owner registered and installed on the repos they chose. Only the link and
 * one-time code of a sign-in in progress, the account's name and its repos ever reach the
 * browser: the sign-in itself stays in the data folder.
 */
export const GitHubConnection = z.discriminatedUnion("kind", [
  /** The worker has no GitHub App to sign in through: the README says how to register one. */
  z.object({ kind: z.literal("not-set-up") }),
  z.object({ kind: z.literal("signed-out") }),
  /** Waiting for the owner to open the link on any device and enter the code. */
  z.object({
    kind: z.literal("waiting"),
    link: z.url({ protocol: /^https$/ }),
    code: z.string(),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  /** The last sign-in didn't finish: its code ran out, the owner said no on GitHub, or it failed. */
  z.object({ kind: z.literal("not-finished"), why: z.enum(["expired", "denied", "failed"]) }),
  z.object({
    kind: z.literal("signed-in"),
    /** The GitHub account signed in, by its name on GitHub. */
    account: z.string(),
    /**
     * The repos the GitHub App is installed on, the only ones a code session can reach, as
     * `owner/name`; `null` when GitHub couldn't be asked just now.
     */
    repos: z.array(z.string()).nullable(),
  }),
]);
export type GitHubConnection = z.infer<typeof GitHubConnection>;
