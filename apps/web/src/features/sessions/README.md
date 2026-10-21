# sessions

The session page: the conversation, its answers and the message box. The worker's side is
[`sessions/`](../../../../worker/src/features/sessions/README.md).

**Example:** you open a session mid-turn. Its turns replay from the event stream, the answer keeps arriving at an
even pace, and the box at the foot takes your next message.

- **Uses:** `components/` (chat, frame, sheets, rich blocks), `features/documents/`, `features/things/`,
  `features/code-home/`.
- **Used by:** `routes/` (the session page, a workspace's page, a document's page), `features/planning-home/`, `features/code-home/`, `features/home/`, `features/pull-requests/`,
  `features/settings/`, `features/things/`; `components/` (the frame, the recent sessions sheet, rich blocks).

## Screens

The session page (`routes/_app/workspaces.$workspaceId.sessions.$sessionId.tsx`), and a workspace's Sessions tab
(`session-links.tsx`, with `kept-sessions.ts` keeping its list).

## Its parts

- **`turns/`:** following the event stream and replaying it into turns (`events.ts`); the turn list
  (`session-turns.tsx`, which follows the end only while the owner is at it, never moving them while they read back,
  and offers Jump to latest, #168); each turn (`turn-view.tsx`); the cut-off card; the usage-limit notice with Carry
  on (`limit-notice.tsx`); what the page has shown (`seen.ts`); and the Lead's strip (`lead-strip.tsx`).
- **`answer/`:** formatting answers (`answer.tsx`, `blocks.ts`; tables and fenced blocks Courtyard draws come from
  `components/rich-blocks/`), revealing text at an even pace (`reveal.ts`), code blocks with their language and Copy
  (`code-block.tsx`), coloured by lowlight (`highlight.tsx`, loaded with the first code block, each language's
  grammar from `code-languages.ts` only when used), formulas drawn by KaTeX (`maths.ts` finds and rewrites them,
  `maths-plugins.ts` is loaded only when an answer has maths, and maths keeps its room unseen until its formulas can
  be drawn), and an answer's Sources (`sources.tsx`).
- **`composer/`:** the message box (`composer.tsx`) with its model, effort and skill pickers (`model-pickers.tsx`,
  `models.ts`, `limits.ts`; the frame's Skills and Model sheets are `handheld-choices.tsx`) and its attachments
  (`attaching.ts` shrinks photos to JPEG and checks each file). `messages.ts` sends a message with its files, beside
  `api/worker.ts` so it's not on the first load.
- **`notes/`:** save notes (`save-note.tsx`), Save as document with each document's note (`documents.tsx`), each Thing
  save's note (`things.tsx`), each project save's note (`projects.tsx`, #603), and the Get to know offer
  (`get-to-know.tsx`).
