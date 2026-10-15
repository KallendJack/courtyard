# matt-setup

The setup card (#181, #323). The worker's side is [`matt-setup/`](../../../../worker/src/features/matt-setup/README.md).

**Example:** Needs you says "Set up this repo". The card lists each line with what was found and its choice; one Set
up does them all, then links its pull request.

- **Uses:** `components/layout/card-dialog.tsx`, `components/forms/segmented-choice.tsx`.
- **Used by:** `features/code-home/` (its row in Needs you, #301).

## Screens

- The setup card (`setup-card.tsx`), a dialog in the middle of the screen: each line with what was found and its
  choice (Keep or Move, Rename or Keep, Create or Skip), one Set up, then where its pull request is.
- Its calls are in `api.ts`.
