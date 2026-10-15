# New repo asks for Administration on Courtyard's GitHub App

Decided on #391 with the owner (2026-10-15, grill decision 7). New workspace → Code makes a GitHub repo on the owner's
account, on the house standard, so starting a project is as easy as starting a session. Creating a repo through
Courtyard's GitHub App needs one more permission than code sessions did.

So **Courtyard's GitHub App asks for Administration (read and write) among its repository permissions.** It's
GitHub's permission for "repository creation"; the grill's "Repository creation: write" names it by that description.
GitHub gives no narrower one. The app stays installed on selected repositories only, and a repo it makes joins them.

**What else it reaches, and why that's acceptable.** Administration also covers a repo's settings, its collaborators
and deleting it, for every repo the app is installed on, and code sessions run `gh` with Courtyard's token. That's
held where it was before:

- **A session still asks first.** `gh repo delete` and every `gh api` call that isn't a read are never on the
  allowlist, so each needs the owner's approval, and Allow all (#428) never covers them either (`code/allowlist.ts`).
- **Courtyard itself uses it for one thing:** `POST /user/repos`, only when the owner taps Create on New repo.
- **It's optional.** An owner who only adds repos they already have leaves it off (README, GitHub); New repo then
  says GitHub refused.

Revisit if GitHub adds a permission that creates repos without managing them.
