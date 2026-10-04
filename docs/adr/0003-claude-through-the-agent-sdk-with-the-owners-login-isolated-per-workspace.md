# Claude runs through the Agent SDK with the owner's login, isolated per workspace

The goal is a subscription, not per-token billing. The worker runs Claude through the Claude Agent SDK, which uses the
Claude Code login on the worker machine, so usage draws from the owner's plan; an API key is the alternative.
Courtyard never reads, stores or logs Claude credentials. As of October 2026, Anthropic's help centre says Agent SDK
use draws from a subscription's usage limits; a move to a separate credit was announced for June 2026 and then paused.
If it changes, the change belongs in the Claude adapter alone.

The SDK's defaults load the machine's whole Claude Code setup: user settings, CLAUDE.md files, auto memory, skills,
and the claude.ai connectors (email, calendar, drive). That would hand every workspace the owner's other tools and
memories. So the adapter turns all of it off (no setting sources, auto memory disabled, connectors disabled, only the
MCP servers the adapter passes in) and gives each turn only its workspace folder, its context file and the workspace's
tool connections.

## Considered options

- **The Claude API directly.** Rejected as the default: per-token billing. Kept as the API-key mode.
- **Driving the interactive CLI in a terminal.** Rejected: no structured events, and no hook for approvals.
- **The SDK with its defaults.** Rejected: it breaks the workspace boundary in ways the owner can't see.

## Consequences

- The SDK docs say third-party developers may not offer claude.ai login in their products without approval. Courtyard
  is software one person runs for themselves with their own login; anyone else running it does the same, or uses an
  API key. The README says so.
- On the smallest plan, usage limits arrive quickly in coding sessions, which is what overflow (ADR 0004) is for.
