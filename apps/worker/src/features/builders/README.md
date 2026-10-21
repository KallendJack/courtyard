# builders

Each Lead builder's status (#590, [ADR 0031](../../../../../docs/adr/0031-the-lead-keeps-each-builders-status-and-every-wait-ends-on-its-own.md)):
one of eight, a recorded fact with since when, moved on as things happen in its session, never worked out again from
its event log.

**Example:** a builder runs `pnpm -C apps/worker exec vitest run test/live.test.ts` while a helper's `pnpm verify`
holds the machine's builds lock. It's **Checking**, one ahead, since it asked; still Checking once the check runs;
**Building** again once it ends. Its turn ends with its pull request open and CI running: **In CI**.

- **Uses:** the contract (`BuilderStatus`), `lib/files.ts`; `notifications/` through `waitsOnYou`, passed in
  (#593).
- **Used by:** `sessions/`, which tells it what happens in a builder's session and starts each carry-on, and lists a
  stuck builder as waiting on the owner, saying why; `lead/`, which decides from each builder's status and serves
  it (`LeadStatus.statuses`); `worker.ts`, which carries on a builder a restart cut off (`carriesOnAfterRestart`)
  and runs `sessions/`' `carryOnAtReset` as one of its jobs.

## API

None of its own: `GET /api/workspaces/:id/lead` gives each builder's status (`statuses`).

## How it works

- **Kept** in the data folder's `builders.json`, beside `leads.json`: each builder's status, whether a turn of its
  runs, its pull request as last heard of, and whether it has been told to carry on. Written only when one changes.
- **What moves it on**, as `sessions/` tells it:
  - a turn starting: **Building**;
  - a heavy check waiting for its place (with how many are ahead) or starting: **Checking**, since it first asked,
    then **Building** once it ends;
  - an approval asked: **Waiting on you**, with the approval; answered: **Building**;
  - its pull request heard of between turns, or merged or closed at any time: **In CI** while its checks run,
    **Ready for review** once they pass, **Building** when they fail or it conflicts (its session fixes it),
    **Merged**, or **Stuck** when it's closed without merging;
  - a turn ending, once its pull request has been looked at: as its pull request says; **Waiting on you** when its
    answer ends in a question mark (the worker's test for a question, for now), or a restart cut it off; **Waiting for the limit** at a
    usage limit, with its reset; **Stuck** when it failed (saying why) or was stopped.
- **One carry-on:** a turn that ends with no pull request and no question is **Building**, and `sessions/` starts a
  turn telling it to carry on (`carriesOn` on its message; docs/ai-conduct.md, Coding). Ending so again, it's
  **Stuck**.
- **At the limit** (#610): Waiting for the limit, until the reset its provider gave (or an hour on, when it gave
  none); then `dueAtReset` names it, and `sessions/`' `carryOnAtReset` (a repeating job) starts a turn of the
  worker's on the same model (`afterLimit` on its message).
- **After a restart** (#610): a turn any restart cut off (an Update, a crash, the PC restarting) is **Waiting on
  you** and carries on by itself once, with Continue's message; cut off again before a turn of its ends otherwise,
  it's **Stuck**.
- **A task's end** always reaches its builder, even while an Update waits (`sessions/`' `tellTasks`).
- **Merged** is where a builder ends: nothing moves it on.
- **Telling the owner** (#593): each time a builder comes to be Waiting on you (but for a turn a restart cut off,
  which carries on by itself) or Stuck, `waitsOnYou` is told once; never again while that status holds.
