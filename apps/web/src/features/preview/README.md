# preview

A code session's preview (#183), as the session page shows it. The worker's side is
[`preview/`](../../../../worker/src/features/preview/README.md).

**Example:** in a session on a web app, the owner taps Start preview beside the branch, checks the command Courtyard
filled in (`pnpm dev`) and taps Start preview again. Once the app serves, the button reads Preview: on the unfolded
Fold and a desktop it opens the app beside the chat, with Open in a tab and a close ×; on the cover screen, in a tab of
its own.

- **Uses:** `components/` (buttons, the info box, the error line, kept answers), the contract.
- **Used by:** `routes/` (the session page's header, and the split beside the chat).

## Screens

- **The Preview button** (`preview.tsx`, `PreviewButton`), beside the branch strip of a code session still taking
  messages: Preview while one of its tasks serves a page, Starting preview… while Start preview's task hasn't said
  where yet, Start preview while none serves and Courtyard knows what to run, and nothing while it doesn't.
- **Start preview's confirm** (`ConfirmPreview`), the first time: the command it'll run, for one tap.
- **The preview beside the chat** (`PreviewPanel`): the app in a frame, its address, Open in a tab and Close.
- `usePreview` asks the worker the shared way, every 2 seconds while it's starting or a task runs; `api.ts` holds the
  calls and the preview's address (the worker's own, on the preview's port).
