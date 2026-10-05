import { createFileRoute } from "@tanstack/react-router";
import { PasswordPage } from "../password-page.tsx";

export const Route = createFileRoute("/login")({
  component: () => (
    <PasswordPage
      title="Log in to Courtyard"
      intro="This device will stay logged in until you log out."
      endpoint="/login"
      autoComplete="current-password"
      submitLabel="Log in"
    />
  ),
});
