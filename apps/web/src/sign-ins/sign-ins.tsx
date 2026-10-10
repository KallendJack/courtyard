import type { GitHubConnection, ProviderSignIn, ProviderStatus } from "@courtyard/contract";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { ConnectionCard, type ConnectionState } from "@/components/connection-card";
import { CopyButton } from "@/components/copy-button";
import { FormError } from "@/components/form-error";
import { InfoBox, Notice, WaitingDot } from "@/components/notice";
import { SectionTitle } from "@/components/page";
import { WebButton } from "@/components/web-link";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { loadProviders } from "../worker.ts";
import {
  changeGitHub,
  changeSignIn,
  loadGitHub,
  loadSignIns,
  startGitHubSignIn,
  startSignIn,
} from "./api.ts";

/** How often the page asks whether a sign-in has finished on the owner's other device. */
const FOLLOW_EVERY_MS = 3000;

/**
 * The providers, the sign-ins Courtyard handles (ADR 0015) and its own GitHub sign-in (#99), as
 * last asked.
 */
type Snapshot = {
  readonly providers: readonly ProviderStatus[];
  readonly signIns: readonly ProviderSignIn[];
  readonly github: GitHubConnection | undefined;
};

/**
 * One copy for the home page's sign-in box and its Connections, which change together: either
 * acting on a sign-in shows in both.
 */
let snapshot: Snapshot = { providers: [], signIns: [], github: undefined };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Counts each time the page asks, so an answer that comes back late never replaces a newer one. */
let asked = 0;

const reload = async () => {
  asked += 1;
  const thisAsk = asked;
  const [providers, signIns, github] = await Promise.all([
    loadProviders(),
    loadSignIns(),
    loadGitHub(),
  ]);
  if (thisAsk !== asked) return;
  snapshot = {
    providers: providers.kind === "loaded" ? providers.data.providers : snapshot.providers,
    signIns: signIns.kind === "loaded" ? signIns.data.signIns : snapshot.signIns,
    github: github.kind === "loaded" ? github.data : snapshot.github,
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
  const waiting =
    models.signIns.some((signIn) => signIn.state.kind === "waiting") ||
    models.github?.kind === "waiting";
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
        <CopyButton label="Copy code" text={() => props.code} look="outline" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <WaitingDot />
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
function SignInCard(props: { models: Models; signIn: ProviderSignIn; provider: ProviderStatus }) {
  const { models, signIn } = props;
  const action = useSignInAction(models, signIn);
  const { state } = signIn;
  let said: string;
  let standing: ConnectionState = "off";
  let act: "start" | "sign-out" | undefined;
  switch (state.kind) {
    case "signed-in": {
      const who = [
        ...(state.email === null ? [] : [`as ${state.email}`]),
        ...(state.plan === null ? [] : [planName(state.plan)]),
      ];
      // Signed in, but still unavailable (Codex needing an update, say): why, as for any provider.
      said = props.provider.available
        ? `Signed in ${who.join(", ")}`.trim()
        : props.provider.reason;
      if (props.provider.available) standing = "connected";
      act = "sign-out";
      break;
    }
    case "waiting":
      said = "Signing in: enter the code above";
      standing = "waiting";
      break;
    case "signed-out":
    case "not-finished":
      said = "Not signed in";
      act = "start";
      break;
    case "unavailable":
      said = state.reason;
      break;
  }
  return (
    <ConnectionCard
      name={signIn.label}
      detail={said}
      state={standing}
      actions={
        act !== undefined && (
          <Button
            variant={act === "start" ? "quietPrimary" : "quiet"}
            size="xs"
            onClick={() => void action.run(act)}
            disabled={action.busy}
          >
            {act === "start" ? "Sign in" : "Sign out"}
          </Button>
        )
      }
    >
      <FormError message={action.error} />
    </ConnectionCard>
  );
}

/** Acts on the GitHub sign-in, then shows where everything stands. */
const useGitHubAction = (models: Models) =>
  useAction(async (change: "start" | "cancel" | "sign-out") => {
    const done = change === "start" ? await startGitHubSignIn() : await changeGitHub(change);
    await models.reload();
    return done.kind === "loaded" ? undefined : describeProblem(done).body;
  });

/** Copies the code to the clipboard as GitHub's page opens, so it's ready to paste there. */
const copyCode = (code: string) => {
  void navigator.clipboard?.writeText(code).catch(() => undefined);
};

/** The repos a sign-in reaches, by name, as the card's line says them. */
const reposLine = (repos: readonly string[] | null) => {
  if (repos === null) return "Couldn't ask GitHub for its repos just now.";
  if (repos.length === 0) {
    return "No repos yet: install Courtyard's GitHub App on the ones sessions may use.";
  }
  return (
    <span className="font-mono">{repos.map((repo) => repo.split("/").at(-1)).join(" · ")}</span>
  );
};

/**
 * Courtyard's own GitHub sign-in (#99): the device code to enter on GitHub, then the account and
 * the repos its GitHub App reaches, with Switch and Sign out.
 */
function GitHubCard(props: { models: Models; github: GitHubConnection }) {
  const { models, github } = props;
  const action = useGitHubAction(models);
  const error = <FormError message={action.error} />;
  const signIn = (label: string) => (
    <Button size="sm" onClick={() => void action.run("start")} disabled={action.busy}>
      {label}
    </Button>
  );

  switch (github.kind) {
    case "not-set-up":
      return (
        <ConnectionCard
          name="GitHub"
          detail="Not set up: register Courtyard's GitHub App, as the README says."
          state="off"
        />
      );
    case "signed-out":
      return (
        <ConnectionCard
          name="GitHub"
          detail="Code sessions push their branch and open a pull request through it."
          state="off"
          actions={signIn("Sign in to GitHub")}
        >
          {error}
        </ConnectionCard>
      );
    case "not-finished":
      return (
        <ConnectionCard
          name="GitHub"
          detail={
            github.why === "expired"
              ? "The code ran out before it was used."
              : github.why === "denied"
                ? "GitHub was told no, so it didn't sign in."
                : "The sign-in didn't finish."
          }
          state="off"
          actions={signIn("Get a new code")}
        >
          {error}
        </ConnectionCard>
      );
    case "waiting":
      return (
        <ConnectionCard name="GitHub" state="waiting">
          <p className="text-xs text-muted-foreground">
            Open {github.link.replace(/^https:\/\//, "")} and enter this code. Code sessions can
            only reach the repos you install Courtyard's GitHub App on.
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="rounded-md border bg-field px-4 py-1 font-mono text-[28px]/[34px] font-semibold tracking-[0.1em]">
              {github.code}
            </span>
            <WebButton href={github.link} size="lg" onClick={() => copyCode(github.code)}>
              Copy, open GitHub
            </WebButton>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <WaitingDot />
              The code works for 15 minutes.
            </p>
            <Button
              variant="quiet"
              size="xs"
              onClick={() => void action.run("cancel")}
              disabled={action.busy}
            >
              Cancel
            </Button>
          </div>
          {error}
        </ConnectionCard>
      );
    case "signed-in":
      return (
        <ConnectionCard
          name={`GitHub · ${github.account}`}
          detail={reposLine(github.repos)}
          state="connected"
          actions={
            <>
              <Button
                variant="outline"
                size="xs"
                onClick={() => void action.run("start")}
                disabled={action.busy}
              >
                Switch
              </Button>
              <Button
                variant="outline"
                size="xs"
                onClick={() => void action.run("sign-out")}
                disabled={action.busy}
              >
                Sign out
              </Button>
            </>
          }
        >
          {error}
        </ConnectionCard>
      );
  }
}

/**
 * Connections, at the foot of the home page: every provider and whether it can be used (story
 * 29), signed in on the worker machine or why not, with Sign in and Sign out for the ones
 * Courtyard signs in to; and GitHub, which Courtyard signs in to itself (#99).
 */
function Connections() {
  const models = useModels();
  const { providers, signIns, github } = models;
  if (providers.length === 0 && github === undefined) return null;
  return (
    <section aria-labelledby="connections" className="mt-12">
      <div id="connections">
        <SectionTitle>Connections</SectionTitle>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5 text-sm/[21px]">
        {providers.map((provider) => {
          const signIn = signIns.find((s) => s.provider === provider.id);
          if (signIn !== undefined) {
            return (
              <SignInCard key={provider.id} models={models} signIn={signIn} provider={provider} />
            );
          }
          return (
            <ConnectionCard
              key={provider.id}
              name={provider.label}
              detail={provider.available ? "Signed in on the worker machine" : provider.reason}
              state={provider.available ? "connected" : "off"}
            />
          );
        })}
        {github !== undefined && <GitHubCard models={models} github={github} />}
      </ul>
    </section>
  );
}

/**
 * On a code workspace's page, where a session would start: that its sessions can't reach GitHub
 * until Courtyard is signed in to it (#99), with the way to Connections.
 */
function GitHubNotice() {
  const { github } = useModels();
  useEffect(() => {
    void reload();
  }, []);
  if (github === undefined || github.kind === "signed-in") return null;
  return (
    <InfoBox label="GitHub isn't connected">
      <span className="min-w-60 flex-1">
        A session here can work, but can't push its branch or open a pull request until Courtyard is
        signed in to GitHub.
      </span>
      <ButtonLink size="sm" to="/" hash="connections">
        Sign in to GitHub
      </ButtonLink>
    </InfoBox>
  );
}

/**
 * The home page's sign-in boxes, near its top, or its Connections, at its foot; or, on a code
 * workspace's page, whether GitHub is connected: one lazy load.
 */
export default function SignIns(props: { part: "boxes" | "list" | "github-notice" }) {
  switch (props.part) {
    case "boxes":
      return <SignInBoxes />;
    case "list":
      return <Connections />;
    case "github-notice":
      return <GitHubNotice />;
  }
}
