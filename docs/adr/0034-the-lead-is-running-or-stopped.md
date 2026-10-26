# The Lead is running or stopped, nothing in between

Decided with the owner on 2026-10-21. Amends ADR 0031. Pausing the Lead used to stop only new builders: the ones
already working carried on, so "Paused" still had work going on that the owner wasn't watching. The owner, in their
words: "I don't want things going on in the background that I'm not aware of. I either want the builders running or
they're not running. That's it."

So:

- **The Lead has two states, Running and Stopped.** Running, it starts builders as ADR 0031 says and they work. Stopped,
  nothing runs: no builder turn, no check, no new builder.
- **Stop ends every builder's turn where it is.** Each builder keeps its branch, its worktree, its pull request and its
  status, shown as Stopped on the board. A check it had running stops too.
- **Run carries every stopped builder on**, once, as a turn a restart cut off does (ADR 0031), and starts new ones as
  places free. Nothing else wakes a stopped builder.
- **Resting goes**: a running Lead with nothing ready says so ("Running · nothing ready to build") and stays running.
- **The board says which, in one line**, with one button: Stop while running, Run while stopped. The counts ("2 of 2
  building · 1 of 4 for review") show only while something is building or waiting for review.

## Considered options

- **Keep Pause (builders carry on, nothing new starts).** Rejected: it's the in-between state the owner doesn't want.
- **Stop that lets the current turn finish first.** Rejected: "stopped" would still mean work running for minutes.
