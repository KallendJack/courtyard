# friction

Something's off (#554): one button on every screen takes the screen as it is, you say what's wrong, and File it
files the issue through a session in Courtyard's own code workspace.

**Example:** on Home the backup line confuses you. You tap Something's off in the right rail: the sheet shows the
screen as it was, and chips for Home, Fold open · 950 × 712, the version and Backup line, the last part you
touched. You hold Talk and say what's off, then tap File it.

- **Uses:** `components/sheets/friction-sheet.tsx` (the sheet), `components/frame/` (the button and Talk),
  `api/send-form.ts`, and `modern-screenshot`, loaded only on the tap.
- **Used by:** `components/frame/handheld-frame.tsx`; on the worker,
  [`features/friction/`](../../../../worker/src/features/friction/README.md).

## Screens

- **The button:** on a tablet's or computer's right rail, in its free space above Talk; on the cover screen, a
  flag key left of Skills and the model, in the Type key's lane. Lit while its sheet is open.
- **The sheet:** rises from the foot of the page, the page dimmed under it and the right rail (or the cover
  screen's talk row) left in reach. It isn't modal, so Talk, Space and the Type key go into its You said box.

## How it works

- **`filled-in.ts`** fills in, at the tap: the page by name (`/` is Home, a session is "Garage · Session"), the
  screen by the sizes boards are drawn at (under 600 px wide Cover, under 1280 Fold open, else Desktop) with its
  size, and the part of the page the owner last touched, named by its nearest block's label or heading. The frame
  keeps the last touch outside its own pieces.
- **`capture.ts`** takes the screen in the browser at the moment of the tap (`modern-screenshot`, an SVG the browser
  draws, so the theme's colours come out as they are), leaving out the sheet itself (`data-friction`), as a JPEG at
  the window's own size. If it can't, the sheet says so and the report files without a picture.
- **`api.ts`** asks where it files (`GET /api/friction`: the workspace and the version) and files it
  (`POST /api/friction`, a multipart form with the screen). Filed, the sheet closes.
