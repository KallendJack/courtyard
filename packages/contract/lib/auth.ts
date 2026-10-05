import { z } from "zod";

/** Whether this device is in: before the owner exists, logged out, or logged in. */
export const AuthState = z.object({
  state: z.enum(["setup-needed", "logged-out", "logged-in"]),
});
export type AuthState = z.infer<typeof AuthState>;

/** The shortest password setup accepts. */
export const MIN_PASSWORD_LENGTH = 8;
/** The longest password accepted, so a huge one can't tie up the worker hashing it. */
export const MAX_PASSWORD_LENGTH = 1024;

/** What the setup and login forms send. */
export const PasswordForm = z.object({ password: z.string().max(MAX_PASSWORD_LENGTH) });
export type PasswordForm = z.infer<typeof PasswordForm>;
