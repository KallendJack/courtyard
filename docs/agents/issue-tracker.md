# Issue tracker: GitHub Issues

Tickets live as GitHub Issues on `KallendJack/courtyard`, read and written with the `gh` CLI. The spec lives in the
repo (`docs/spec.md`); each Issue is one ticket from it.

## Conventions

- **Title:** `NN: <what it delivers>`, numbered from `01` in build order across all phases.
- **Body:** what to build, `Blocked by: #N` when it depends on another ticket, and a checklist of acceptance criteria.
- **Labels:** the phase (`phase-1` to `phase-6`) and a triage label from the table below.
- **Status** is GitHub's own: open, then closed once the PR that finishes it is merged (`Closes #N` in the PR
  description).
- **Conversation** happens in Issue and PR comments. Read them with `gh issue view N --comments` and
  `gh pr view N --comments`, and review comments on code with `gh api repos/KallendJack/courtyard/pulls/N/comments`.

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

`gh issue create --title "NN: ..." --label phase-1 --label ready-for-agent --body-file <file>`.

## When a skill says "fetch the relevant ticket"

`gh issue view N --comments`.
