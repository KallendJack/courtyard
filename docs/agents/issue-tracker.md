# Issue tracker: GitHub Issues

Tickets live as GitHub Issues on `KallendJack/courtyard`, read and written with the `gh` CLI. The spec lives in the
repo (`docs/spec.md`); each Issue is one ticket from it, or an idea waiting to become one.

## Conventions

- **Title:** `NN: <what it delivers>` for a ticket, numbered from `01` in build order. An idea has a plain title until
  it becomes a ticket.
- **Body:** what to build, `Blocked by: #N` when it depends on another ticket, and a checklist of acceptance criteria.
- **Labels** say what kind of issue it is: `enhancement` or `bug`, a triage label from the table below, and `tracker`
  for an issue that's checked at the end of each milestone rather than built (#111 parity). The `phase-0` to
  `phase-3` labels are kept on closed issues as history; new issues don't get a phase label.
- **Milestone** says where it sits in the roadmap (below).
- **Status** is GitHub's own: open, then closed once the PR that finishes it is merged (`Closes #N` in the PR
  description). Check it closed, and close it by hand if not.
- **Conversation** happens in Issue and PR comments. Read them with `gh issue view N --comments` and
  `gh pr view N --comments`, and review comments on code with `gh api repos/KallendJack/courtyard/pulls/N/comments`.

## The roadmap

The order of work is the repo's **milestones**: the one place it's kept. Not the spec, not a chat, not an agent's
memory.

- **Each milestone is a group of work** that leaves something usable, titled `N · <name>`, worked through in number
  order. `Later` holds parked ideas, in no order.
- **Its description gives the build order inside it:** `Build order: #A → #B → #C.`, with a note when something
  waits on the owner.
- **Every open issue is in exactly one milestone,** except trackers.

### Keeping it current

Whoever files, finishes or moves work updates the roadmap in the same step:

- **Filing an issue:** put it in a milestone (`Later` when unsure) and add it to that milestone's build order. Say in
  the issue body or the hand-over which milestone it went into and why, so the owner can move it.
- **Finishing a milestone:** close it once its issues are closed, and check the trackers (`--label tracker`).
- **Moving work** (the owner reprioritises, or something new crops up): move the issue with
  `gh issue edit N --milestone "<title>"`, and fix both milestones' build orders.
- **A new group:** create it in the right place and renumber the titles after it. Milestones are matched by title, so
  renumbering is a rename, nothing else.
- **Checking it:** this should print nothing but trackers:

  ```sh
  gh issue list --state open --search "no:milestone" --json number,title,labels
  ```

  and this shows the roadmap in order:

  ```sh
  gh api "repos/KallendJack/courtyard/milestones?state=open&per_page=100" \
    --jq 'sort_by((.title | split(" ")[0] | tonumber?) // 999)[] | "\(.title) (\(.closed_issues)/\(.open_issues + .closed_issues) done): \(.description)"'
  ```

Changing the order is the owner's call. An agent proposes a move with its reason, and makes it once the owner agrees.

## Triage labels

| Role in mattpocock/skills | Label             | Meaning                                  |
| ------------------------- | ----------------- | ---------------------------------------- |
| `needs-triage`            | `needs-triage`    | Needs evaluating                         |
| `needs-info`              | `needs-info`      | Waiting on more information              |
| `ready-for-agent`         | `ready-for-agent` | Fully specified, ready for an agent      |
| `ready-for-human`         | `ready-for-human` | Needs the owner (a purchase, a NAS step) |
| `wontfix`                 | `wontfix`         | Will not be actioned                     |

The spec is a file, not an Issue, so its triage state is a `Status:` line at its top.

## When a skill says "publish to the issue tracker"

`gh issue create --title "NN: ..." --label enhancement --label ready-for-agent --milestone "<title>" --body-file <file>`,
then add it to that milestone's build order.

## When a skill says "fetch the relevant ticket"

`gh issue view N --comments`.
