import { useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { describeProblem } from "./problems.tsx";
import { toWorker } from "./worker.ts";

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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const refusal =
      props.check?.(password) ??
      (props.confirm && password !== repeated ? "The two passwords don't match." : undefined);
    if (refusal) return setError(refusal);

    setSending(true);
    const result = await toWorker(props.endpoint, { password });
    setSending(false);
    if (result.kind === "loaded") {
      setError(undefined);
      await router.invalidate();
      return;
    }
    setError(describeProblem(result).body);
  };

  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-2xl font-semibold">{props.title}</h1>
      <div className="mt-2 text-neutral-600">{props.intro}</div>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block">
          <span className="text-sm font-medium">Password</span>
          <input
            type="password"
            autoComplete={props.autoComplete}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>
        {props.confirm && (
          <label className="block">
            <span className="text-sm font-medium">Password again</span>
            <input
              type="password"
              autoComplete="new-password"
              value={repeated}
              onChange={(event) => setRepeated(event.target.value)}
              className="mt-1 block w-full rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={sending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 font-medium text-white disabled:opacity-50"
        >
          {props.submitLabel}
        </button>
      </form>
    </main>
  );
}
