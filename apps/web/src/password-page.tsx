import { useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/button";
import { CourtyardMark } from "@/components/courtyard-mark";
import { FormError } from "@/components/form-error";
import { TextField } from "@/components/text-field";
import { useAction } from "@/lib/use-action";
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
  const send = useAction(async () => {
    const result = await sendPassword(props.endpoint, { password });
    if (result.kind !== "loaded") return describeProblem(result).body;
    // In: go to the workspaces explicitly rather than waiting for a re-check to redirect.
    await router.navigate({ to: "/" });
    return undefined;
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const refusal =
      props.check?.(password) ??
      (props.confirm && password !== repeated ? "The two passwords don't match." : undefined);
    if (refusal) return send.setError(refusal);
    void send.run();
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
          <TextField
            label="Password"
            type="password"
            autoComplete={props.autoComplete}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {props.confirm && (
            <TextField
              label="Password again"
              type="password"
              autoComplete="new-password"
              value={repeated}
              onChange={(event) => setRepeated(event.target.value)}
            />
          )}
          <FormError message={send.error} />
          <Button type="submit" size="lg" fullWidth disabled={send.busy}>
            {props.submitLabel}
          </Button>
        </form>
      </div>
    </main>
  );
}
