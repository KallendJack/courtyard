import { gitOrNothing } from "../git.ts";
import { createOneAtATime } from "../one-at-a-time.ts";
import { err, ok } from "../result.ts";
import type {
  DeviceSignIn,
  FoundCheck,
  FoundCheckRun,
  FoundFile,
  FoundPullRequest,
  FoundRepo,
  GitHubApi,
  SignInEnd,
  UserToken,
} from "./api.ts";

/** A repo the fake GitHub's app is installed on, and what it says of it (#258). */
export type FakeRepo = {
  readonly fullName: string;
  readonly description?: string;
  readonly private?: boolean;
  readonly cloneUrl?: string;
  readonly pushedAt?: string;
};

/** An issue on the fake GitHub (#301): `ready-for-agent` unless a test gives its labels. */
export type FakeIssue = {
  readonly number: number;
  readonly title: string;
  readonly milestone?: string;
  readonly labels?: readonly string[];
  /** Its comments' text, oldest first. */
  readonly comments?: readonly string[];
  readonly state?: "open" | "closed";
};

/** How long the fake's tokens last, as GitHub's do: 8 hours. */
const TOKEN_SECONDS = 8 * 60 * 60;

const STATUSES: Readonly<Record<string, FoundFile["status"]>> = {
  A: "added",
  D: "removed",
  M: "modified",
};

/**
 * For the browser tests: the files commit `head` changes since `main` in a bare repository, with
 * their diffs, as GitHub lists a pull request's.
 */
const filesPushed = async (remote: string, head: string): Promise<FoundFile[]> => {
  const range = `main...${head}`;
  const statuses = (await gitOrNothing(remote, ["diff", "--name-status", range])) ?? "";
  const files: FoundFile[] = [];
  for (const line of statuses.split("\n")) {
    const [status, path] = line.split("\t");
    if (status === undefined || path === undefined) continue;
    const diff = (await gitOrNothing(remote, ["diff", range, "--", path])) ?? "";
    const hunks = diff.slice(Math.max(0, diff.indexOf("\n@@") + 1));
    const lines = hunks.split("\n");
    files.push({
      path,
      status: STATUSES[status] ?? "modified",
      additions: lines.filter((text) => text.startsWith("+")).length,
      deletions: lines.filter((text) => text.startsWith("-")).length,
      patch: hunks.startsWith("@@") ? hunks : null,
    });
  }
  return files;
};

/**
 * For tests only: GitHub in memory (#99), so signing in, refreshing and who is signed in are
 * tested with no network. A device sign-in waits until the test says how it ends (`approve`,
 * `deny`, `expire`), or finishes by itself after `finishAfterMs`. Each token it gives out works
 * until it's refreshed; `lapse` makes GitHub refuse the refresh token, as after six months.
 *
 * It holds pull requests too (#172): a test opens one for a branch, sets its checks, and merges or
 * closes it, as the model's gh and GitHub itself would; Courtyard's Merge and Close act on it too
 * (#160), and a test can give it files and a conflict. With `opensOnPush`, for the browser tests,
 * a branch pushed to that bare repository (GitHub's copy, on disk) has a pull request opened for
 * it the first time it's asked about, changing the files the branch changes since `main`, and each
 * commit pushed there gets the `checks` its subject says. A test sets the checks on a commit of
 * main's (`setCommitChecks`), as main's build (#249), and keeps what Courtyard did about a red
 * main (#355): each re-run, each issue filed, and its milestones' descriptions.
 */
export const createFakeGitHub = (
  options: {
    account?: string;
    /**
     * The repos the GitHub App is installed on: by `owner/name`, or with what GitHub says of it
     * (#258). A repo's `cloneUrl` is its address on GitHub unless a test points it at a bare
     * repository on disk, standing in for GitHub's copy.
     */
    repos?: readonly (string | FakeRepo)[];
    finishAfterMs?: number;
    /** Each repository's labels to start with (#181). */
    labels?: Readonly<Record<string, readonly string[]>>;
    /** Each repository's issues to start with (#301). */
    issues?: Readonly<Record<string, readonly FakeIssue[]>>;
    /** Each repository's milestones' descriptions, by title (#336). */
    milestones?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    opensOnPush?: {
      readonly remote: string;
      /** The repository it is GitHub's copy of, as `owner/name`; every one unless it says. */
      readonly repo?: string;
      /** The checks on a commit pushed, from its subject. */
      readonly checks: (subject: string) => readonly FoundCheck[];
      /** Whether a commit pushed conflicts with `main`, from its subject (#278). */
      readonly conflicts?: (subject: string) => boolean;
    };
  } = {},
) => {
  const account = options.account ?? "octo-owner";
  const repos: readonly FoundRepo[] = (
    options.repos ?? [`${account}/courtyard`, `${account}/stacks`]
  ).map((repo) => {
    const given = typeof repo === "string" ? { fullName: repo } : repo;
    return {
      fullName: given.fullName,
      description: given.description ?? null,
      private: given.private ?? true,
      cloneUrl: given.cloneUrl ?? `https://github.com/${given.fullName}.git`,
      pushedAt: given.pushedAt ?? null,
    };
  });
  let issued = 0;
  let codes = 0;
  /** The access token that works now, and its refresh token. */
  let current: { accessToken: string; refreshToken: string } | undefined;
  /** How the sign-in waiting now ends, once the test says. */
  let ending: ((how: "approved" | SignInEnd) => void) | undefined;

  const issue = (): UserToken => {
    issued += 1;
    current = { accessToken: `ghu_fake${issued}`, refreshToken: `ghr_fake${issued}` };
    return { ...current, expiresIn: TOKEN_SECONDS };
  };
  const end = (how: "approved" | SignInEnd) => {
    const was = ending;
    ending = undefined;
    was?.(how);
  };

  /** Each repository's labels, in the order they were made (#181). */
  const labels = new Map(
    Object.entries(options.labels ?? {}).map(([repo, names]) => [repo, [...names]]),
  );
  /** Each repository's issues, each with its comments as they're added (#301). */
  const issues = new Map(
    Object.entries(options.issues ?? {}).map(([repo, list]) => [
      repo,
      list.map((issue) => ({ ...issue, comments: [...(issue.comments ?? [])] })),
    ]),
  );
  /** Each repository's milestones, numbered from 1 in the order given, by title (#336, #355). */
  const milestones = new Map(
    Object.entries(options.milestones ?? {}).map(([repo, described]) => [
      repo,
      Object.entries(described).map(([title, description], at) => ({
        number: at + 1,
        title,
        description,
      })),
    ]),
  );
  const milestoneIn = (repo: string, title: string) =>
    milestones.get(repo)?.find((milestone) => milestone.title === title);
  /** Each issue Courtyard filed, in order (#355). */
  const filed: {
    readonly number: number;
    readonly title: string;
    readonly body: string;
    readonly labels: readonly string[];
    readonly milestone: string | null;
  }[] = [];
  /** Each time Courtyard re-ran a commit's failed jobs, in order (#355). */
  const reruns: { readonly repo: string; readonly commit: string }[] = [];
  /** The failing test each check run's annotations name, by its id (#355). */
  const failures = new Map<number, string>();
  /** How many times the repositories' issues were asked for, as a test checks they're kept. */
  let issuesAsked = 0;
  const issueIn = (repo: string, number: number) =>
    issues.get(repo)?.find((issue) => issue.number === number);
  /** The checks on each commit a test set them for (#249), and how often they were asked for. */
  const commitChecks = new Map<string, readonly FoundCheckRun[]>();
  let commitChecksAsked = 0;
  /** Each branch deleted on GitHub, in order. */
  const deleted: { readonly repo: string; readonly branch: string }[] = [];
  /** Every pull request opened, numbered from 1, with the files it changes (#160). */
  const pulls: (FoundPullRequest & {
    readonly repo: string;
    readonly branch: string;
    readonly files: readonly FoundFile[];
  })[] = [];
  const pullNumbered = (number: number) => {
    const at = pulls.findIndex((pull) => pull.number === number);
    if (at === -1) throw new Error(`The fake GitHub has no pull request #${number}`);
    return at;
  };
  const change = (number: number, to: Partial<(typeof pulls)[number]>) => {
    const at = pullNumbered(number);
    const pull = pulls[at];
    if (pull !== undefined) pulls[at] = { ...pull, ...to };
  };
  /** A pull request's size, from the files it changes, as GitHub counts it. */
  const changesOf = (files: readonly FoundFile[]) => ({
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    files: files.length,
  });
  const openPullRequest = (open: {
    repo: string;
    branch: string;
    head: string;
    /** The files it changes, with their diffs: none unless a test says. */
    files?: readonly FoundFile[];
    /** Its title and description, as the model wrote them with gh. */
    title?: string;
    body?: string;
    /** Who opened it, by their login: the account signed in unless a test says (#278). */
    author?: string;
  }) => {
    const number = pulls.length + 1;
    const files = open.files ?? [];
    pulls.push({
      repo: open.repo,
      branch: open.branch,
      title: open.title ?? `Pull request ${number}`,
      body: open.body ?? "",
      head: open.head,
      base: "main",
      number,
      url: `https://github.com/${open.repo}/pull/${number}`,
      state: "open",
      checks: [],
      files,
      changes: changesOf(files),
      conflicts: false,
      fork: false,
      author: open.author ?? account,
      mergedAt: null,
    });
    return number;
  };
  /** The token works now; else GitHub's refusal. */
  const refusedToken = (accessToken: string) =>
    accessToken === current?.accessToken ? undefined : err("That token doesn't work.");
  const latestFor = (find: { repo: string; branch: string }) =>
    pulls.findLast((pull) => pull.repo === find.repo && pull.branch === find.branch);
  /** A pull request as GitHub gives it, without what only the fake keeps. */
  const found = (pull: (typeof pulls)[number]): FoundPullRequest => {
    const { repo: _, files: __, ...rest } = pull;
    return rest;
  };
  /** Merged now, as GitHub records it. */
  const merged = (number: number) =>
    change(number, { state: "merged", mergedAt: new Date().toISOString() });

  /** GitHub's copy on disk of `repo`, when the browser tests have one. */
  const onPushFor = (repo: string) => {
    const onPush = options.opensOnPush;
    return onPush !== undefined && (onPush.repo === undefined || onPush.repo === repo)
      ? onPush
      : undefined;
  };

  /**
   * For the browser tests: the pull request for a branch pushed to GitHub's copy on disk, one at
   * a time, so two pages asking at once never open a branch's pull request twice.
   */
  const pushedInTurn = createOneAtATime();
  const pushed = (find: { repo: string; branch: string }) => pushedInTurn(() => pushedNow(find));
  const pushedNow = async (find: { repo: string; branch: string }) => {
    const onPush = onPushFor(find.repo);
    if (onPush === undefined) return;
    const head = await gitOrNothing(onPush.remote, ["rev-parse", `refs/heads/${find.branch}`]);
    if (head === undefined) return;
    const pull = latestFor(find);
    if (pull !== undefined && (pull.head === head || pull.state !== "open")) return;
    const files = await filesPushed(onPush.remote, head);
    const subject = (await gitOrNothing(onPush.remote, ["log", "-1", "--format=%s", head])) ?? "";
    const checks = onPush.checks(subject);
    const conflicts = onPush.conflicts?.(subject) ?? false;
    if (pull === undefined) {
      // Titled and described by its first commit, as gh pr create --fill would.
      const body = (await gitOrNothing(onPush.remote, ["log", "-1", "--format=%b", head])) ?? "";
      change(openPullRequest({ ...find, head, files, title: subject, body: body.trim() }), {
        checks,
        conflicts,
      });
    } else {
      change(pull.number, { head, checks, conflicts, files, changes: changesOf(files) });
    }
  };

  const api: GitHubApi = {
    startSignIn: async () => {
      codes += 1;
      return ok({
        deviceCode: `device-${codes}`,
        code: `FAKE-${String(codes).padStart(4, "0")}`,
        link: "https://github.com/login/device",
        expiresIn: 900,
        interval: 5,
      });
    },
    finishSignIn: (_device: DeviceSignIn, signal: AbortSignal) =>
      new Promise((resolve) => {
        const finishing =
          options.finishAfterMs === undefined
            ? undefined
            : setTimeout(() => end("approved"), options.finishAfterMs);
        const ended = (how: "approved" | SignInEnd) => {
          clearTimeout(finishing);
          signal.removeEventListener("abort", cancelled);
          resolve(how === "approved" ? ok(issue()) : err(how));
        };
        const cancelled = () => {
          if (ending === ended) ending = undefined;
          ended("cancelled");
        };
        ending = ended;
        signal.addEventListener("abort", cancelled, { once: true });
      }),
    refresh: async (refreshToken) => {
      if (current === undefined || refreshToken !== current.refreshToken) return err("lapsed");
      return ok(issue());
    },
    account: async (accessToken) =>
      accessToken === current?.accessToken
        ? ok({ login: account, repos: repos.map((repo) => repo.fullName) })
        : err("That token doesn't work."),
    repositories: async (accessToken) => refusedToken(accessToken) ?? ok(repos),
    pullRequest: async (accessToken, find) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      await pushed(find);
      const pull = latestFor(find);
      return ok(pull === undefined ? null : found(pull));
    },
    pullRequestNumbered: async (accessToken, find) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const pull = pulls.find((each) => each.repo === find.repo && each.number === find.number);
      return ok(pull === undefined ? null : found(pull));
    },
    openPullRequests: async (accessToken, find) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      // For the browser tests: every branch pushed to GitHub's copy has its pull request, whoever
      // pushed it.
      const onPush = onPushFor(find.repo);
      if (onPush !== undefined) {
        const listed = await gitOrNothing(onPush.remote, [
          "for-each-ref",
          "--format=%(refname:short)",
          "refs/heads",
        ]);
        for (const branch of (listed ?? "").split("\n")) {
          if (branch !== "" && branch !== "main") await pushed({ repo: find.repo, branch });
        }
      }
      return ok(
        pulls
          .filter((pull) => pull.repo === find.repo && pull.state === "open")
          .reverse()
          .map(found),
      );
    },
    commitChecks: async (accessToken, { commit }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      commitChecksAsked += 1;
      return ok(commitChecks.get(commit) ?? []);
    },
    pullRequestFiles: async (accessToken, { number }) =>
      refusedToken(accessToken) ?? ok(pulls[pullNumbered(number)]?.files ?? []),
    openIssues: async (accessToken, { repo, label, withComments }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      issuesAsked += 1;
      return ok(
        (issues.get(repo) ?? [])
          .filter(
            (issue) =>
              (issue.state ?? "open") === "open" &&
              (issue.labels ?? ["ready-for-agent"]).includes(label),
          )
          .map((issue) => ({
            number: issue.number,
            title: issue.title,
            url: `https://github.com/${repo}/issues/${issue.number}`,
            milestone: issue.milestone ?? null,
            milestoneDescription:
              issue.milestone === undefined
                ? null
                : (milestoneIn(repo, issue.milestone)?.description ?? null),
            comments: withComments ? [...issue.comments] : [],
          })),
      );
    },
    openPullRequestTexts: async (accessToken, { repo }) =>
      refusedToken(accessToken) ??
      ok(
        pulls
          .filter((pull) => pull.repo === repo && pull.state === "open")
          .map((pull) => ({ title: pull.title, body: pull.body })),
      ),
    commentOnIssue: async (accessToken, { repo, number, body }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const issue = issueIn(repo, number);
      if (issue === undefined) return err("GitHub said: Not Found");
      issue.comments.push(body);
      return ok(null);
    },
    merge: async (accessToken, { number, head }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const pull = pulls[pullNumbered(number)];
      if (pull?.state !== "open") return err("GitHub said: Pull Request is not mergeable");
      if (pull.conflicts) return err("GitHub said: Pull Request is not mergeable");
      if (pull.head !== head) return err("GitHub said: Head branch was modified.");
      merged(number);
      return ok(null);
    },
    close: async (accessToken, { number }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      change(number, { state: "closed" });
      return ok(null);
    },
    deleteBranch: async (accessToken, find) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      deleted.push({ repo: find.repo, branch: find.branch });
      const onPush = onPushFor(find.repo);
      if (onPush !== undefined) {
        await gitOrNothing(onPush.remote, ["update-ref", "-d", `refs/heads/${find.branch}`]);
      }
      return ok(null);
    },
    labels: async (accessToken, { repo }) =>
      refusedToken(accessToken) ?? ok([...(labels.get(repo) ?? [])]),
    createLabel: async (accessToken, label) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const names = labels.get(label.repo) ?? [];
      if (names.includes(label.name)) return err("GitHub said: Validation Failed");
      labels.set(label.repo, [...names, label.name]);
      return ok(null);
    },
    openPullRequest: async (accessToken, pull) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const onPush = onPushFor(pull.repo);
      const head =
        onPush === undefined
          ? undefined
          : await gitOrNothing(onPush.remote, ["rev-parse", `refs/heads/${pull.branch}`]);
      const number = openPullRequest({
        repo: pull.repo,
        branch: pull.branch,
        head: head ?? "",
        title: pull.title,
        body: pull.body,
      });
      return ok({ number, url: `https://github.com/${pull.repo}/pull/${number}` });
    },
    rerunFailedJobs: async (accessToken, find) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      reruns.push({ repo: find.repo, commit: find.commit });
      return ok(null);
    },
    checkRunFailure: async (accessToken, { id }) =>
      refusedToken(accessToken) ?? ok(failures.get(id) ?? null),
    openMilestones: async (accessToken, { repo }) =>
      refusedToken(accessToken) ?? ok((milestones.get(repo) ?? []).map((each) => ({ ...each }))),
    describeMilestone: async (accessToken, { repo, number, description }) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      const milestone = milestones.get(repo)?.find((each) => each.number === number);
      if (milestone === undefined) return err("GitHub said: Not Found");
      milestone.description = description;
      return ok(null);
    },
    createIssue: async (accessToken, issue) => {
      const refused = refusedToken(accessToken);
      if (refused !== undefined) return refused;
      // Issues and pull requests share GitHub's numbers.
      const number =
        Math.max(
          0,
          ...(issues.get(issue.repo) ?? []).map((each) => each.number),
          ...pulls.map((pull) => pull.number),
        ) + 1;
      const milestone =
        milestones.get(issue.repo)?.find((each) => each.number === issue.milestone)?.title ?? null;
      filed.push({
        number,
        title: issue.title,
        body: issue.body,
        labels: [...issue.labels],
        milestone,
      });
      issues.set(issue.repo, [
        ...(issues.get(issue.repo) ?? []),
        {
          number,
          title: issue.title,
          labels: [...issue.labels],
          comments: [],
          ...(milestone === null ? {} : { milestone }),
        },
      ]);
      return ok({ number, url: `https://github.com/${issue.repo}/issues/${number}` });
    },
  };

  return {
    api,
    /** The owner entered the code and said yes. */
    approve: () => end("approved"),
    /** The owner said no on GitHub. */
    deny: () => end("denied"),
    /** The code ran out before it was used. */
    expire: () => end("expired"),
    /** GitHub won't take the refresh token any more, nor its access token. */
    lapse: () => {
      current = undefined;
    },
    /** The access token that works now, if any. */
    token: () => current?.accessToken,
    /** The model opened a pull request from `branch`, its latest commit `head`: its number. */
    openPullRequest,
    /** The pull request's checks are now these; on a new commit `head`, if it was pushed. */
    setChecks: (number: number, checks: readonly FoundCheck[], head?: string) =>
      change(number, { checks, ...(head === undefined ? {} : { head }) }),
    /** The pull request now conflicts with its base, or no longer does (#160). */
    setConflicts: (number: number, conflicts: boolean) => change(number, { conflicts }),
    /** Its state on GitHub now, as a test checks Merge or Close reached it (#160). */
    stateOf: (number: number) => pulls[pullNumbered(number)]?.state,
    /** The pull request was merged, on GitHub or from Courtyard. */
    merge: merged,
    /** The pull request was closed without merging. */
    close: (number: number) => change(number, { state: "closed" }),
    /** The checks on `commit` are now these, in the order GitHub lists them (#249). */
    setCommitChecks: (commit: string, checks: readonly FoundCheckRun[]) => {
      commitChecks.set(commit, checks);
    },
    /** Check run `id`'s annotations name `test` as what failed (#355). */
    setFailure: (id: number, test: string) => {
      failures.set(id, test);
    },
    /** Each time Courtyard re-ran a commit's failed jobs, in order (#355). */
    reruns: () => [...reruns],
    /** Each issue Courtyard filed, in order, with its milestone's title (#355). */
    issuesFiled: () => [...filed],
    /** Milestone `title`'s description in `repo` now (#355). */
    milestoneDescription: (repo: string, title: string) => milestoneIn(repo, title)?.description,
    /** How many times Courtyard has asked for a commit's checks (#249). */
    commitChecksAsked: () => commitChecksAsked,
    /** Each branch Courtyard deleted on GitHub, in order. */
    branchesDeleted: () => [...deleted],
    /** A repository's labels now, in the order they were made (#181). */
    labelsOf: (repo: string) => [...(labels.get(repo) ?? [])],
    /** The comments on issue `number` in `repo` now, oldest first (#301). */
    commentsOn: (repo: string, number: number) => [...(issueIn(repo, number)?.comments ?? [])],
    /** Someone comments on issue `number` in `repo` (a claim, say). */
    comment: (repo: string, number: number, body: string) => {
      issueIn(repo, number)?.comments.push(body);
    },
    /** How many times the repositories' issues were asked for. */
    issuesAsked: () => issuesAsked,
    /** The number of the latest pull request from `branch`, if any. */
    pullRequestFrom: (branch: string) => pulls.findLast((pull) => pull.branch === branch)?.number,
  };
};

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
