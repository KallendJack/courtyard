import {
  CONTEXT_LINE_MAX_CHARACTERS,
  type GitHubRepo,
  type GitHubRepoList,
  WORKSPACE_NAME_MAX_LENGTH,
} from "@courtyard/contract";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form-error";
import { useDock, useLayout } from "@/components/handheld";
import { CodeMark, RepoPicker } from "@/components/repo-picker";
import { SegmentedChoice } from "@/components/segmented-choice";
import { TextField, WrappingTextField } from "@/components/text-field";
import { addStylesheet } from "@/lib/stylesheet";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { addWorkspace, type FromWorker } from "../worker.ts";
import { loadRepos } from "./api.ts";
import css from "./new-workspace.css?inline";

// The page's own stylesheet (new-workspace.css), added once, when it first loads.
addStylesheet("new-workspace", css);

type Kind = "planning" | "code";

/** A repo's name as a workspace's: its words, each with a capital (garrett-kitchens → Garrett Kitchens). */
const nameFromRepo = (repo: string) =>
  repo
    .split(/[-_.\s]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * New workspace's form (#258, #264; Paper board "Tablet · New workspace, Code"): Planning, as it
 * always was, or Code, which lists the owner's GitHub repos to pick one from. Picking one fills in
 * what can be known (its name, and what it's for from its description on GitHub), all shown before
 * Create. On a touch screen nothing is focused until tapped, so the keyboard doesn't cover the
 * page, and the Talk key fills in what it's for.
 */
export function NewWorkspaceForm() {
  const router = useRouter();
  const layout = useLayout();
  const dock = useDock();
  const [kind, setKind] = useState<Kind>("planning");
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  const [picked, setPicked] = useState<GitHubRepo>();
  /** What picking a repo last filled in, so picking another replaces it but not what was typed. */
  const filled = useRef({ name: "", intro: "" });
  const introBox = useRef<HTMLTextAreaElement>(null);
  const introNow = useRef(intro);
  introNow.current = intro;
  const [repos, setRepos] = useState<FromWorker<GitHubRepoList> | { kind: "loading" }>();

  // The owner's repos, asked for once Code is first chosen.
  const wantsRepos = kind === "code" && repos === undefined;
  useEffect(() => {
    if (!wantsRepos) return;
    setRepos({ kind: "loading" });
    void loadRepos().then(setRepos);
  }, [wantsRepos]);

  // The Talk key and the talk strip fill in what it's for (#264), after anything typed.
  useEffect(
    () =>
      dock?.offerField({
        focus: () => introBox.current?.focus(),
        answering: false,
        dictate: () => {
          const typed = introNow.current;
          const put = (words: string) =>
            setIntro(
              words === "" ? typed : typed.trim() === "" ? words : `${typed.trimEnd()} ${words}`,
            );
          return { hear: put, drop: () => put(""), done: () => {} };
        },
      }),
    [dock],
  );

  const pick = (repo: GitHubRepo) => {
    setPicked(repo);
    const was = filled.current;
    const next = { name: nameFromRepo(repo.name), intro: repo.description ?? "" };
    if (name.trim() === "" || name === was.name) setName(next.name);
    if (intro.trim() === "" || intro === was.intro) setIntro(next.intro);
    filled.current = next;
  };

  const code = kind === "code";
  const add = useAction(async () => {
    if (code && picked === undefined) return "Pick a repo first.";
    const workspace = await addWorkspace({
      name,
      intro,
      ...(code && picked !== undefined ? { repo: picked.repo } : {}),
    });
    if (workspace.kind !== "loaded") return describeProblem(workspace).body;
    // Every list of workspaces now includes it.
    await router.invalidate();
    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: workspace.data.id },
      // A code workspace opens with its Connections sheet, offering Paper, which Close skips (#308).
      ...(code ? { hash: "connections" } : {}),
    });
    return undefined;
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void add.run();
  };

  const nameField = (error: string | undefined) => (
    <TextField
      label="Name"
      error={error}
      value={name}
      onChange={(event) => setName(event.target.value)}
      maxLength={WORKSPACE_NAME_MAX_LENGTH}
      placeholder={code ? "Garrett Kitchens" : "Garage gym"}
      autoComplete="off"
      required
      // The name is the one thing this page needs; on a touch screen the keyboard waits for a tap
      // (#264), so it doesn't cover the page before it's read.
      autoFocus={layout === "desktop"}
    />
  );
  const introField = (hint: string) => (
    <WrappingTextField
      ref={introBox}
      label="What's it for?"
      optional
      hint={hint}
      value={intro}
      // One line, however it was pasted.
      onChange={(event) => setIntro(event.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
      maxLength={CONTEXT_LINE_MAX_CHARACTERS}
      placeholder={
        code ? "Website for a kitchen fitter" : "Turning the garage into a home gym by Christmas"
      }
      autoComplete="off"
    />
  );
  const talks = dock !== undefined;

  return (
    // Where the page's own classes apply (new-workspace.css).
    <div data-new-workspace="" className="contents">
      <div className="mt-5 flex flex-col gap-3.5">
        <SegmentedChoice
          label="Kind"
          look="switch"
          options={[
            { value: "planning", label: "Planning" },
            { value: "code", label: "Code", icon: <CodeMark /> },
          ]}
          value={kind}
          onChange={setKind}
        />
        {code ? (
          <form onSubmit={submit} className="flex flex-col gap-3.5">
            <Repos repos={repos} picked={picked?.repo} pick={pick} />
            <div className="grid items-start gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              {nameField(undefined)}
              {introField(talks ? "From the repo, or hold Talk." : "From the repo.")}
            </div>
            <FormError message={add.error} />
            <div className="flex justify-end">
              <Button
                type="submit"
                size="lg"
                disabled={picked === undefined}
                busy={add.busy}
                busyLabel="Creating…"
              >
                {name.trim() === "" ? "Create" : `Create ${name.trim()}`}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={submit} className="max-w-sm space-y-4">
            {nameField(add.error)}
            {introField(
              `One line${talks ? ", or hold Talk" : ""}. It sits at the top of the context file, and Get to know starts from it.`,
            )}
            <Button type="submit" busy={add.busy} busyLabel="Adding…">
              Add workspace
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

/** The owner's repos to pick from, or why they can't be listed. */
function Repos(props: {
  repos: FromWorker<GitHubRepoList> | { kind: "loading" } | undefined;
  picked: string | undefined;
  pick: (repo: GitHubRepo) => void;
}) {
  const { repos } = props;
  if (repos === undefined || repos.kind === "loading") {
    return <p className="text-body text-muted-foreground">Looking up your repos…</p>;
  }
  if (repos.kind === "loaded") {
    return repos.data.repos.length === 0 ? (
      <p className="text-body text-muted-foreground">
        Courtyard's GitHub App doesn't reach any of your repos yet. Add them to it on GitHub.
      </p>
    ) : (
      <RepoPicker repos={repos.data.repos} value={props.picked} onChange={props.pick} />
    );
  }
  if (repos.kind === "not-found") {
    return (
      <p className="text-body text-muted-foreground">
        GitHub isn't set up on this worker: register Courtyard's GitHub App first (README, GitHub).
      </p>
    );
  }
  // Signed out of GitHub: the way to sign in is one tap away.
  if (repos.kind === "failed" && repos.status === 409) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted-foreground">{repos.message}</p>
        <ButtonLink size="sm" to="/settings" hash="connections">
          Sign in to GitHub
        </ButtonLink>
      </div>
    );
  }
  return <FormError message={describeProblem(repos).body} />;
}
