import { useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { CourtyardMark } from "@/components/courtyard-mark";
import { PillButton } from "@/components/pill-button";
import { Input } from "@/components/ui/input";
import { describeProblem } from "./problems.tsx";
import { sendPassword } from "./worker.ts";

/**
 * The setup and login pages share one shape: a title, a password form, and on success the router
 * re-checks the login and moves on. `check` can refuse before anything is sent.
 */
export function PasswordPage(props: {
  title: string;
  intro: ReactNode;
  endpoint: "/setup" | "/login";
  autoComplete: "new-password" | "current-password";
  submitLabel: string;
  confirm?: boolean;
  check?: (password: string) => string | undefined;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeated, setRepeated] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const passwordId = useId();
  const repeatedId = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const refusal =
      props.check?.(password) ??
      (props.confirm && password !== repeated ? "The two passwords don't match." : undefined);
    if (refusal) return setError(refusal);

    setSending(true);
    const result = await sendPassword(props.endpoint, { password });
    setSending(false);
    if (result.kind === "loaded") {
      setError(undefined);
      // In: go to the workspaces explicitly rather than waiting for a re-check to redirect.
      await router.navigate({ to: "/" });
      return;
    }
    setError(describeProblem(result).body);
  };

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 md:p-8">
        <CourtyardMark size={40} />
        <h1 className="mt-5 font-display text-[26px]/[31px] font-medium tracking-[-0.02em]">
          {props.title}
        </h1>
        <div className="mt-2 text-[15px]/[23px] text-muted-foreground">{props.intro}</div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor={passwordId} className="text-sm font-medium">
              Password
            </label>
            <Input
              id={passwordId}
              type="password"
              autoComplete={props.autoComplete}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 h-11 bg-field text-base focus-visible:border-primary focus-visible:ring-accent"
            />
          </div>
          {props.confirm && (
            <div>
              <label htmlFor={repeatedId} className="text-sm font-medium">
                Password again
              </label>
              <Input
                id={repeatedId}
                type="password"
                autoComplete="new-password"
                value={repeated}
                onChange={(event) => setRepeated(event.target.value)}
                className="mt-1.5 h-11 bg-field text-base focus-visible:border-primary focus-visible:ring-accent"
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}
          <PillButton type="submit" disabled={sending} className="h-11 w-full">
            {props.submitLabel}
          </PillButton>
        </form>
      </div>
    </main>
  );
}
