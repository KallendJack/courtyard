# Courtyard

A self-hosted place to plan projects and write code with AI models, where every area of your life keeps its own
context, so you never re-explain your space, your constraints or your stack.

- **Workspaces are folders.** One per project or area, each with a short `CONTEXT.md` split into facts, plans and ideas.
- **Context stays true.** Models suggest changes when you ask; only the ones you tick get in, and each is a git commit.
- **Your subscriptions, not per-token billing.** Claude through your own Claude Code login, with Codex on a ChatGPT plan
  for when Claude's usage limit hits.
- **Real coding.** In a code workspace, Claude works on its own branch while you're away, asks before anything risky,
  and you review and merge from your phone.
- **Yours alone.** One owner, plain files, no database, private network only.

Status: being built. What is being built is in [`docs/spec.md`](docs/spec.md).

## Claude

Courtyard talks to Claude through Claude Code on the machine its worker runs on (the Agent SDK),
so it uses whatever that machine is signed in with:

- **Your Claude plan:** log in once with Claude Code on the worker machine (`claude`, then
  `/login`). Courtyard's usage counts against your plan's limits, like Claude Code's own.
- **Or an API key:** set `ANTHROPIC_API_KEY` in the worker's environment. That's billed per token.

Courtyard never reads, stores or logs either. Anthropic doesn't let apps offer a claude.ai login
to other people, so everyone who runs Courtyard signs in with their own. Set
`COURTYARD_CLAUDE_PROVIDER=0` to leave Claude out.

Each session sees only its own workspace's folder: none of the machine's Claude Code settings,
memory, skills or connectors, and in planning workspaces it can only read. What is being built is in [`docs/spec.md`](docs/spec.md), the vocabulary in
[`GLOSSARY.md`](GLOSSARY.md), and why it is built this way in [`docs/adr/`](docs/adr/).
