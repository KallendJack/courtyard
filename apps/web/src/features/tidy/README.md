# tidy

Asking for a tidy, and the review with its tick boxes. The worker's side is
[`tidy/`](../../../../worker/src/features/tidy/README.md).

**Example:** you tap Tidy. The review lists each proposed change with a tick box; Save keeps only the ticked ones.

- **Uses:** `components/forms/tick-box.tsx`, `components/layout/kept.tsx`.
- **Used by:** the Tidy page (`routes/_app/tidy.tsx`).

## Screens

- Tidy (`tidy-review.tsx`, with its calls in `api.ts`): while it waits, faint rows in its own shape under its title.
