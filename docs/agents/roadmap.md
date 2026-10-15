# Roadmap: GitHub milestones

Courtyard's own addition to the issue tracker (`issue-tracker.md` is Matt's and stays as his setup writes it). The order
of work across the project is the repo's **milestones**: the one place it's kept. Not the spec, not a chat, not an
agent's memory. Inside a spec, order comes from GitHub's blocked-by links, as Matt's skills set them.

- **Each milestone is a group of work** that leaves something usable, titled `N · <name>`, worked through in number
  order. `Later` holds parked ideas, in no order.
- **Its description gives the build order inside it:** `Build order: #A → #B → #C.`, with a note when something waits
  on the owner. A code workspace's Next up reads this line: it ends at the first full stop, so notes go after it.
  Issues on it that edit the same files are each marked blocked by the one before (GitHub's blocked by): Next up
  keeps a blocked one in its place, "After …", with no Build until its blocker closes (#377).
- **Every open issue is in exactly one milestone.**

## What comes first

**Friction the owner hits in real use comes first.** When the owner reports something that got in the way (a screenshot
from the Fold, "it is annoying that…"), turn it into a small Paper draft or an issue straight away, and propose where it
goes in the order, usually ahead of features nobody has missed yet. Invented features wait in `Later` until real use
asks for them.

## Keeping it current

Whoever files, finishes or moves work updates the roadmap in the same step:

- **Filing an issue** (including when a skill publishes to the issue tracker): put it in a milestone (`Later` when
  unsure) and add it to that milestone's build order. Say which milestone and why, so the owner can move it.
  The `Roadmap` workflow (`.github/workflows/roadmap.yml`) is the safety net: an issue that comes in without a
  milestone goes into `Later` (with `needs-triage` when it has no triage label), on filing and once a day.
- **Titles sort as text** in some GitHub views, so keep every number to one digit: fold or renumber rather than add
  a `10 ·`.
- **Finishing a milestone:** close it once its issues are closed.
- **Moving work:** `gh issue edit N --milestone "<title>"`, and fix both milestones' build orders.
- **A new group:** create it in the right place and renumber the titles after it. Milestones are matched by title, so
  renumbering is a rename.
- **Checking it:** this should print nothing:

  ```sh
  gh issue list --state open --search "no:milestone" --json number,title
  ```

  and this shows the roadmap in order:

  ```sh
  gh api "repos/KallendJack/courtyard/milestones?state=open&per_page=100" \
    --jq 'sort_by((.title | split(" ")[0] | tonumber?) // 999)[] | "\(.title) (\(.closed_issues)/\(.open_issues + .closed_issues) done): \(.description)"'
  ```

Changing the order is the owner's call. An agent proposes a move with its reason, and makes it once the owner agrees.
