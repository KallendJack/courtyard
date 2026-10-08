import type { ProviderSignIn, ProviderStatus } from "@courtyard/contract";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { InfoBox, Notice } from "@/components/notice";
import { SectionTitle } from "@/components/page";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { loadProviders } from "../worker.ts";
import { changeSignIn, loadSignIns, startSignIn } from "./api.ts";

/** How often the page asks whether a sign-in has finished on the owner's other device. */
const FOLLOW_EVERY_MS = 3000;

/** The providers and the sign-ins Courtyard handles (ADR 0015), as last asked. */
type Snapshot = {
  readonly providers: readonly ProviderStatus[];
  readonly signIns: readonly ProviderSignIn[];
};

/**
 * One copy for the home page's sign-in box and its Models list, which change together: either
 * acting on a sign-in shows in both.
 */
let snapshot: Snapshot = { providers: [], signIns: [] };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const reload = async () => {
  const [providers, signIns] = await Promise.all([loadProviders(), loadSignIns()]);
  snapshot = {
    providers: providers.kind === "loaded" ? providers.data.providers : snapshot.providers,
    signIns: signIns.kind === "loaded" ? signIns.data.signIns : snapshot.signIns,
  };
  for (const listener of listeners) listener();
};

/** Where the providers and sign-ins stand, asked for when the home page shows. */
const useModels = () => {
  const now = useSyncExternalStore(subscribe, () => snapshot);
  return { ...now, reload };
};

type Models = ReturnType<typeof useModels>;

/**
 * Asks again every few seconds while a sign-in waits for the owner, so the page carries on by
 * itself once they've finished on their other device.
 */
const useFollowing = (models: Models) => {
  useEffect(() => {
    void reload();
  }, []);
  const waiting = models.signIns.some((signIn) => signIn.state.kind === "waiting");
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void reload(), FOLLOW_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting]);
};

/** Starts a sign-in, or acts on one, then shows where everything stands. */
const useSignInAction = (models: Models, signIn: ProviderSignIn) =>
  useAction(async (change: "start" | "cancel" | "sign-out" | "not-now") => {
    const done =
      change === "start"
        ? await startSignIn(signIn.provider)
        : await changeSignIn(signIn.provider, change);
    await models.reload();
    return done.kind === "loaded" ? undefined : describeProblem(done).body;
  });

/** The other providers the owner can carry on with, by name, for "when Claude runs out". */
const othersThan = (models: Models, signIn: ProviderSignIn) =>
  models.providers
    .filter((provider) => provider.available && provider.id !== signIn.provider)
    .map((provider) => provider.label);

/** A sign-in waiting for the owner: where to go, the code to enter there, and Cancel. */
function Waiting(props: {
  signIn: ProviderSignIn;
  link: string;
  code: string;
  onCancel: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.code);
      setCopied(true);
    } catch {
      // Without the clipboard (a page served over plain HTTP, say) the code can still be typed.
    }
  };
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-foreground">
        On any device, open{" "}
        <a href={props.link} target="_blank" rel="noreferrer" className="font-medium underline">
          {props.link.replace(/^https:\/\//, "")}
        </a>
        , sign in to {props.signIn.service} and enter this code:
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-[28px]/[34px] font-semibold tracking-[0.1em] text-foreground">
          {props.code}
        </span>
        <Button variant="outline" size="xs" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy code"}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
          Waiting for you to finish. The code works for 15 minutes.
        </p>
        <Button variant="quiet" size="xs" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One provider's sign-in box, or nothing once it's signed in or the owner said Not now. */
function SignInBox(props: { models: Models; signIn: ProviderSignIn }) {
  const { models, signIn } = props;
  const action = useSignInAction(models, signIn);
  const { state, label, service } = signIn;
  const error = <FormError message={action.error} />;

  switch (state.kind) {
    case "waiting":
      return (
        <>
          <InfoBox label={`Sign in to ${label}`}>
            <Waiting
              signIn={signIn}
              link={state.link}
              code={state.code}
              busy={action.busy}
              onCancel={() => void action.run("cancel")}
            />
          </InfoBox>
          {error}
        </>
      );
    case "not-finished":
      return (
        <div className="mt-4">
          <Notice
            title={`${label} didn't sign in`}
            action={
              <Button
                variant="notice"
                size="sm"
                onClick={() => void action.run("start")}
                disabled={action.busy}
              >
                Get a new code
              </Button>
            }
          >
            {state.why === "expired"
              ? "The code ran out before it was used."
              : "The sign-in didn't finish."}
          </Notice>
          {error}
        </div>
      );
    case "signed-out": {
      if (signIn.notNow) return null;
      const others = othersThan(models, signIn);
      const why =
        others.length === 0
          ? "to use its models"
          : `to carry on there when ${others.join(" or ")} runs out`;
      return (
        <>
          <InfoBox label={`Sign in to ${label}`}>
            <span className="min-w-60 flex-1">
              {label} isn't signed in. Sign in with your {service} plan {why}.
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => void action.run("not-now")}
                disabled={action.busy}
              >
                Not now
              </Button>
              <Button size="sm" onClick={() => void action.run("start")} disabled={action.busy}>
                Sign in to {label}
              </Button>
            </span>
          </InfoBox>
          {error}
        </>
      );
    }
    case "signed-in":
    case "unavailable":
      return null;
  }
}

/** Each sign-in that needs the owner, near the top of the home page. */
function SignInBoxes() {
  const models = useModels();
  useFollowing(models);
  return models.signIns.map((signIn) => (
    <SignInBox key={signIn.provider} models={models} signIn={signIn} />
  ));
}

/** "plus" as the owner reads it: "Plus plan". */
const planName = (plan: string) => `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;

/** Where a provider Courtyard signs in to stands, and what the owner can do about it. */
function SignInRow(props: { models: Models; signIn: ProviderSignIn }) {
  const { models, signIn } = props;
  const action = useSignInAction(models, signIn);
  const { state } = signIn;
  let said: string;
  let act: "start" | "sign-out" | undefined;
  switch (state.kind) {
    case "signed-in": {
      const who = [
        ...(state.email === null ? [] : [`as ${state.email}`]),
        ...(state.plan === null ? [] : [planName(state.plan)]),
      ];
      said = `signed in ${who.join(", ")}`.trim();
      act = "sign-out";
      break;
    }
    case "waiting":
      said = "signing in: enter the code above";
      break;
    case "signed-out":
    case "not-finished":
      said = "not signed in";
      act = "start";
      break;
    case "unavailable":
      said = state.reason;
      break;
  }
  return (
    <li className="py-2.5">
      <div className="flex items-center justify-between gap-3">
        <span>
          {signIn.label} · {said}
        </span>
        {act !== undefined && (
          <Button
            variant={act === "start" ? "quietPrimary" : "quiet"}
            size="xs"
            onClick={() => void action.run(act)}
            disabled={action.busy}
          >
            {act === "start" ? "Sign in" : "Sign out"}
          </Button>
        )}
      </div>
      <FormError message={action.error} />
    </li>
  );
}

/**
 * Every provider and whether it can be used (story 29), at the foot of the home page: signed in
 * on the worker machine, or why not, with Sign in and Sign out for the ones Courtyard signs in to.
 */
function ModelsList() {
  const models = useModels();
  const { providers, signIns } = models;
  if (providers.length === 0) return null;
  return (
    <section aria-labelledby="models" className="mt-12">
      <div id="models">
        <SectionTitle>Models</SectionTitle>
      </div>
      <ul className="mt-3 divide-y border-y text-sm/[21px]">
        {providers.map((provider) => {
          const signIn = signIns.find((s) => s.provider === provider.id);
          if (signIn !== undefined) {
            return <SignInRow key={provider.id} models={models} signIn={signIn} />;
          }
          return (
            <li key={provider.id} className="py-2.5">
              {provider.label} ·{" "}
              {provider.available ? "signed in on the worker machine" : provider.reason}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The home page's sign-in boxes, near its top, or its Models list, at its foot: one lazy load. */
export default function SignIns(props: { part: "boxes" | "list" }) {
  return props.part === "boxes" ? <SignInBoxes /> : <ModelsList />;
}
