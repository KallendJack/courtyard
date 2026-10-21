# Nothing merges without green checks

Decided with the owner on 2026-10-21, after an audit of the six code workspaces found that nothing required a pull
request's checks to pass before it merged (#640). GitHub's branch protection would, but on the owner's plan it covers
public repositories only, and the owner doesn't want to pay for it. Every merge the owner makes goes through
Courtyard, so Courtyard enforces it, for every repository, at no cost. Amends ADR 0031 for the Lead's merges.

So:

- **Courtyard merges a pull request only when every check on it has passed.** A skipped check counts as passed. A
  failing or still-running check, or none at all, refuses the merge and says why in plain words ("Unit tests failed",
  "E2E 2/5 still running", "This repo runs no checks yet"). That holds for Merge on a PR page, Merge in order, and
  every merge the Lead makes.
- **Merge in order stops at the first pull request that isn't green**, naming it; the ones before it stay merged.
- **A repository with no CI can't be merged through Courtyard** until it has some. Its first stack PR adds CI
  (#642), and the house check (#644) flags one without.
- **There's no override in Courtyard.** A red pull request that really must go in is merged on GitHub by the owner,
  knowingly.

## Considered options

- **GitHub branch protection or rulesets.** Rejected for now: private repositories need GitHub Pro. Courtyard's own
  repository is public and could have it free, but one rule for every repository is simpler.
- **A warning with "Merge anyway".** Rejected: the audit's point is that green is the rule, not a suggestion; GitHub
  stays the place for the rare exception.
