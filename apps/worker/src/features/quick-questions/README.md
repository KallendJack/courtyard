# quick-questions

Quick questions about a pull request (#327): a small read-only conversation on its page, whoever opened it.

**Example:** on a PR's page you ask "does this touch the login?". A model reads the PR's diff and answers, pointing at
the lines it means, and changes nothing.

- **Uses:** `pull-requests/` (the PR's review, and `carryOver`), `prompts/` (the wording), `providers/`
  (`answerOnce`), `workspaces/`.
- **Used by:** `worker.ts`; in the web app, `features/pull-requests/` (`quick-questions.tsx`).

## API

- `GET`, `POST /api/workspaces/:id/pull-requests/:number/questions`: the conversation, and a new question.
- `POST /api/workspaces/:id/pull-requests/:number/fix`: Fix it in a session.

## How it works

- Each question is a one-off question (`answerOnce`, no tools, no files), so its model reads the pull request and
  changes nothing, and no session, branch or worktree is involved.
- It keeps the lines an answer points at only where the diff shows them.
- It keeps each pull request's conversation in the worker's memory (the latest 50), one question at a time.
- Fix it in a session hands the conversation, as the worker's message, to `pull-requests/`'s `carryOver`: the
  session on its branch, or a new one there.
