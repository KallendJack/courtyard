import {
  CONTEXT_LINE_MAX_CHARACTERS,
  type GitHubRepo,
  type GitHubRepoList,
  type NewRepoOffer,
  REPO_NAME_MAX_LENGTH,
  repoNameFrom,
  WORKSPACE_NAME_MAX_LENGTH,
  workspaceNameFrom,
} from "@courtyard/contract";
import { useRouter } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/button";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form-error";
import { useDock, useFinePointer } from "@/components/handheld";
import { Page } from "@/components/page";
import { CodeMark, RepoPicker } from "@/components/repo-picker";
import { SegmentedChoice } from "@/components/segmented-choice";
import { TextField, WrappingTextField } from "@/components/text-field";
import { addStylesheet } from "@/lib/stylesheet";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { addWorkspace, type FromWorker } from "../worker.ts";
import { createRepo, loadNewRepoOffer, loadRepos } from "./api.ts";
import css from "./new-workspace.css?inline";

// The page's own stylesheet (new-workspace.css), added once, when it first loads.
addStylesheet("new-workspace", css);

type Kind = "planning" | "code";

/** What a new repo starts with (#391), as the owner reads it before Create. */
const NEW_REPO_STARTS =
  "Starts with GitHub issues and the triage labels, a first milestone, AGENTS.md, GLOSSARY.md and docs/. No stack yet: Grill on Next up picks it, and that session adds CI.";

/**
 * New workspace's form (#258, #264; Paper board "Tablet · New workspace, Code"): Planning, as it
 * always was, or Code, which lists the owner's GitHub repos to pick one from. Picking one fills in
 * what can be known (its name, and what it's for from its description on GitHub), all shown before
 * Create. On a touch screen nothing is focused until tapped, so the keyboard doesn't cover the
 * page, and the Talk key fills in what it's for. The page under `header`, with Create at its foot.
 */
export function NewWorkspaceForm(props: { header: ReactNode }) {
  const router = useRouter();
  const formId = useId();
  const finePointer = useFinePointer();
  const dock = useDock();
  const [kind, setKind] = useState<Kind>("planning");
  const [name, setName] = useState("");
  const [intro, setIntro] = useState("");
  /** A repo of the owner's, or New repo (#391). */
  const [picked, setPicked] = useState<GitHubRepo | "new">();
  const [repoName, setRepoName] = useState("");
  /** The repo name filled in from what it's for, so what's typed over it stays. */
  const filledRepoName = useRef("");
  const [hidden, setHidden] = useState(true);
  const [paper, setPaper] = useState(true);
  const [offer, setOffer] = useState<FromWorker<NewRepoOffer>>();
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
    void loadNewRepoOffer().then(setOffer);
  }, [wantsRepos]);

  // New repo's name follows what it's for, said or typed, until the owner types one (#391).
  useEffect(() => {
    if (picked !== "new") return;
    const next = repoNameFrom(intro);
    const before = filledRepoName.current;
    filledRepoName.current = next;
    setRepoName((was) => (was.trim() === "" || was === before ? next : was));
  }, [intro, picked]);

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
    const next = { name: workspaceNameFrom(repo.name), intro: repo.description ?? "" };
    if (name.trim() === "" || name === was.name) setName(next.name);
    if (intro.trim() === "" || intro === was.intro) setIntro(next.intro);
    filled.current = next;
  };

  /**
   * New repo picked: what it's for clears what a picked repo filled in; the name it filled stays
   * known, so picking a repo again replaces it.
   */
  const pickNew = () => {
    if (intro === filled.current.intro) {
      setIntro("");
      filled.current = { ...filled.current, intro: "" };
    }
    setPicked("new");
  };

  const code = kind === "code";
  const making = code && picked === "new";
  const add = useAction(async () => {
    if (code && picked === undefined) return "Pick a repo first.";
    if (making) {
      const made = await createRepo({
        name: repoName.trim(),
        intro: intro.trim(),
        private: hidden,
        paper: paper && offer?.kind === "loaded" && offer.data.paper,
      });
      if (made.kind !== "loaded") return describeProblem(made).body;
      await router.invalidate();
      // Straight into its code workspace, where Next up offers Grill on its first idea.
      await router.navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: made.data.workspace.id },
      });
      return undefined;
    }
    const workspace = await addWorkspace({
      name,
      intro,
      ...(code && picked !== undefined && picked !== "new" ? { repo: picked.repo } : {}),
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
      autoFocus={finePointer}
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

  // The button that adds it is pinned at the page's foot (#339), outside the form, which it names.
  const footer = code ? (
    <div className="flex flex-col gap-2 pt-3 pb-6">
      <FormError message={add.error} />
      <div className="flex justify-end">
        <Button
          form={formId}
          type="submit"
          size="lg"
          disabled={picked === undefined}
          busy={add.busy}
          busyLabel="Creating…"
        >
          {making
            ? repoName.trim() === ""
              ? "Create"
              : `Create ${repoName.trim()}`
            : name.trim() === ""
              ? "Create"
              : `Create ${name.trim()}`}
        </Button>
      </div>
    </div>
  ) : (
    <div className="pt-3 pb-6">
      <Button form={formId} type="submit" busy={add.busy} busyLabel="Adding…">
        Add workspace
      </Button>
    </div>
  );

  return (
    // Where the page's own classes apply (new-workspace.css).
    <div data-new-workspace="" className="contents">
      <Page header={props.header} footer={footer}>
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
            <form id={formId} onSubmit={submit} className="flex flex-col gap-3.5">
              <Repos
                repos={repos}
                picked={picked === "new" ? undefined : picked?.repo}
                pick={pick}
                newRepo={{ chosen: making, onChoose: pickNew }}
              />
              {making ? (
                <>
                  <div className="grid items-start gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <TextField
                      label="Repo name"
                      value={repoName}
                      onChange={(event) => setRepoName(event.target.value)}
                      maxLength={REPO_NAME_MAX_LENGTH}
                      placeholder="bike-servicing"
                      autoComplete="off"
                      spellCheck={false}
                      required
                    />
                    {introField(talks ? "From what you said, or hold Talk." : "One line.")}
                  </div>
                  <NewRepoCard
                    workspace={workspaceNameFrom(repoName.trim())}
                    offer={offer}
                    hidden={hidden}
                    onHidden={setHidden}
                    paper={paper}
                    onPaper={setPaper}
                  />
                </>
              ) : (
                <div className="grid items-start gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                  {nameField(undefined)}
                  {introField(talks ? "From the repo, or hold Talk." : "From the repo.")}
                </div>
              )}
            </form>
          ) : (
            <form id={formId} onSubmit={submit} className="max-w-sm space-y-4">
              {nameField(add.error)}
              {introField(
                `One line${talks ? ", or hold Talk" : ""}. It sits at the top of the context file, and Get to know starts from it.`,
              )}
            </form>
          )}
        </div>
      </Page>
    </div>
  );
}

/**
 * What a new repo is made with (#391; Paper, "Tablet · New workspace, Code: New repo"), each a
 * chip a tap changes: private or public, the account it's made on, and its Paper file when
 * Courtyard can make one; then what it starts with.
 */
function NewRepoCard(props: {
  /** The workspace made on it, named from the repo. */
  workspace: string;
  offer: FromWorker<NewRepoOffer> | undefined;
  hidden: boolean;
  onHidden: (hidden: boolean) => void;
  paper: boolean;
  onPaper: (paper: boolean) => void;
}) {
  const offer = props.offer?.kind === "loaded" ? props.offer.data : undefined;
  return (
    <section
      aria-label="New repo"
      className="flex flex-col gap-2.5 rounded-card border bg-surface px-4 py-3.5"
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="xs"
          aria-pressed={props.hidden}
          onClick={() => props.onHidden(!props.hidden)}
        >
          {props.hidden ? "Private" : "Public"}
        </Button>
        {offer !== undefined && (
          <span className="flex h-9 items-center rounded-full bg-muted px-3 text-sm font-semibold md:h-7">
            {offer.account}
          </span>
        )}
        {offer?.paper === true && (
          <Button
            variant="outline"
            size="xs"
            aria-pressed={props.paper}
            onClick={() => props.onPaper(!props.paper)}
          >
            {props.paper ? "Paper file · 4 pages" : "No Paper file"}
          </Button>
        )}
      </div>
      <p className="text-meta text-muted-foreground">
        {props.workspace === "" ? "" : `Its workspace: ${props.workspace}. `}
        {NEW_REPO_STARTS}
      </p>
    </section>
  );
}

/** The owner's repos to pick from, or why they can't be listed. */
function Repos(props: {
  repos: FromWorker<GitHubRepoList> | { kind: "loading" } | undefined;
  picked: string | undefined;
  pick: (repo: GitHubRepo) => void;
  newRepo: { chosen: boolean; onChoose: () => void };
}) {
  const { repos } = props;
  if (repos === undefined || repos.kind === "loading") {
    return <p className="text-body text-muted-foreground">Looking up your repos…</p>;
  }
  if (repos.kind === "loaded") {
    return (
      <>
        <RepoPicker
          repos={repos.data.repos}
          value={props.picked}
          onChange={props.pick}
          newRepo={props.newRepo}
        />
        {repos.data.repos.length === 0 && (
          <p className="text-body text-muted-foreground">
            Courtyard's GitHub App doesn't reach any of your repos yet. Add them to it on GitHub, or
            start a new one.
          </p>
        )}
      </>
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
