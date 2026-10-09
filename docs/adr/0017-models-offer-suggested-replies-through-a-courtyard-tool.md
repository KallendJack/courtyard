# Models offer suggested replies through a Courtyard tool

When a model asks the owner a question with a few likely answers, as grilling and Get to know do (#90), it can offer
two or three **suggested replies**. The owner taps one to send it as their reply, or types their own. They have to
look and behave the same on Claude, Codex and the fake, so a model offers them through a Courtyard tool, as it saves
context (ADR 0013), not through anything in its own text.

- **The tool.** "Suggest replies" takes two or three short replies. The worker checks them (count and length),
  records them as an event, and the chat shows them as buttons under the answer. It's offered in planning workspaces
  on every turn whose provider offers Courtyard's tools.
- **When to use it** is a rule in `docs/ai-conduct.md`: only after asking the owner a question that has a few likely
  answers, never with an ordinary answer. The eval set checks both.
- **Tapping one sends it** as the owner's next message, straight away. The buttons go once the owner has replied, by
  either route.

## Considered options

- **A marked-up block in the answer,** which the web app turns into buttons. Rejected: models get such formats
  slightly wrong, the raw block shows while the answer streams in, and the web app would be treating model text as
  commands.
- **A second model writing likely replies after each answer,** like smart replies in email. Rejected: an extra call
  on every turn, against the owner's plan, and buttons that arrive late.
- **Putting the reply in the box to edit before sending.** Rejected for speed on a phone; typing a reply of one's own
  is always there.

## Consequences

- **Codex gets the tool the way it gets the save tool** (#71), so it waits for that.
- **One more thing a model is told on every turn** in a planning workspace, which the eval keeps from being overused.
- **The same tool can serve other skills** that ask the owner questions, with no change to the app.
- **What a model writes after the call is kept,** apart from any line repeating what its answer had already written:
  Claude treats what it writes after its last tool call as its answer and often writes it all again, so the tool's
  reply tells it to write only what's missing, and the worker drops the repeat (#127, #133; `docs/ai-conduct.md`).
