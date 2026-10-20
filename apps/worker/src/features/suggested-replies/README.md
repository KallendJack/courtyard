# suggested-replies

Checks the replies a model suggests with the suggest replies tool (ADR 0017).

**Example:** after an answer about tyres, the model suggests "Cheaper ones?" and "Fit them myself". They show as
buttons under the answer; a tap sends one.

- **Uses:** nothing but the contract.
- **Used by:** `sessions/`, `prompts/` (the tool's replies).

## API

None: the replies reach the browser as an event in the session's stream.

## How it works

- Two or three, each a few words on one line, all different, one set per answer.
- Once they're taken, keeps what the answer writes after them apart from lines it repeats, word for word or in
  other words (#613).
