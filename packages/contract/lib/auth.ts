import { z } from "zod";

/** Whether this device is in: before the owner exists, logged out, or logged in. */
export const AuthState = z.object({
  state: z.enum(["setup-needed", "logged-out", "logged-in"]),
});
export type AuthState = z.infer<typeof AuthState>;

/** What the setup and login forms send. */
export const PasswordForm = z.object({ password: z.string() });
export type PasswordForm = z.infer<typeof PasswordForm>;

/** The shortest password setup accepts. */
export const MIN_PASSWORD_LENGTH = 8;
