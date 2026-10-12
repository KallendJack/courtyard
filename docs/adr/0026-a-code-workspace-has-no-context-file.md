# A code workspace has no context file

Amends ADRs 0010 and 0013 for code workspaces, decided with the owner on #208 and #301 (2026-10-11, 2026-10-12). A
code workspace's knowledge lives in its repository (AGENTS.md, issues, ADRs, milestones), where Claude Code on the PC
and helpers read it too, and its models could never save to its context file anyway (they save only to How to answer
me). A second store only Courtyard reads would drift from the repository and mislead its models. So **a code
workspace has no `CONTEXT.md`: its page doesn't show one and its turns don't read one.**

- Its one line, What it's for, moves into its `workspace.json` as `description`, beside its name, repository and
  connections. New workspace → Code writes them there and no context file. A context file one has from before is read
  only for its title and intro line, until its `workspace.json` has a name and a description; nothing else of it is
  shown or sent to a model.
- In the context file's place, each code turn gets one line about the workspace's connections: what it has, and what's
  missing and where the owner adds it (#308; `docs/ai-conduct.md`, Connections).
- The owner context stays (ADR 0010): a code turn still reads How to answer me, and still saves only there. Its
  Recent changes live with the owner context, not on the code workspace's page.

## Considered options

- **A small Notes link to the context file.** Rejected by the owner: a store only Courtyard reads, which models can't
  save to, would hold stale facts the repository has moved past.
- **Moving the file's lines into the repository.** Not needed: both live code workspaces' files had no lines.
