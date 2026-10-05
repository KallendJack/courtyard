import { MIN_PASSWORD_LENGTH } from "@courtyard/contract";
import { createFileRoute } from "@tanstack/react-router";
import { PasswordPage } from "../password-page.tsx";

export const Route = createFileRoute("/setup")({
  component: () => (
    <PasswordPage
      title="Set up Courtyard"
      intro="Choose the password you'll log in with. Courtyard has one owner, and that's you."
      endpoint="/setup"
      autoComplete="new-password"
      submitLabel="Create my login"
      confirm
      check={(password) =>
        password.length < MIN_PASSWORD_LENGTH
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
          : undefined
      }
    />
  ),
});
