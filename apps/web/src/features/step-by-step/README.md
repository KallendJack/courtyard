# step-by-step

Step by step (#241; Paper, "Tablet · Step by step"): an answer's numbered steps, one at a time, read aloud.

**Example:** an answer says how to fit a chain in six steps. Step by step shows step 1 big and reads it out; you say
"next" with oily hands.

- **Uses:** `features/sessions/` (`answer/steps.ts` finds the steps; the composer's `standIn`), `components/frame/`
  (`offerCommands`).
- **Used by:** the session page, in a planning workspace.

## Screens

The session page, in place of the conversation, loaded only then.

## How it works

- A stylesheet of its own (`step-by-step.css`, holding the thumb buttons' classes too).
- Each step is read aloud in the browser's own voice (`read-aloud.ts`), and the reading line stands in for the Reply
  box (`Composer`'s `standIn`) until Type a reply.
- While it's open, the page offers the dock its commands (`offerCommands`), which the talk strip and the Talk key talk
  to ahead of the box: "next", "back" and "repeat", only when the owner talks.
