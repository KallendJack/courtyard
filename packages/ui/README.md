# @courtyard/ui

The theme and the shared pieces both apps use, the web app (`apps/web`) and Fabrication (`apps/fabrication`,
ADR 0036), so they look and behave the same without copying anything (ADR 0012, #703). A piece only one app
uses stays in that app.

**Example:** a page in either app is `layout/page.tsx`'s `Page`, its rows load with `layout/kept.tsx`, and its chat
ends in the Reply box, `reply/reply-box.tsx`.

| Folder | What's in it |
|---|---|
| `theme.css` | The one theme, Handheld: every colour, font, type size, radius and effect, by name |
| `lib/` | `classes.ts`, which joins classes without merging, so nothing that merges reaches the first load |
| `layout/` | `page.tsx` (pinned header, one scrolling middle, pinned footer, #339) with `page-scroll.ts`, `scroller.tsx` (#420), `kept.tsx`, the loading piece and how blocks stay fresh (#269, #387), and `caps-label.tsx`, the one label in capitals (#242) |
| `buttons/` | `button.tsx`: the pill and icon buttons, and the busy button (`useBusy`, #330); `chip.tsx`, the chip: a few words in a pill that say what something is, never a button; `web-link.tsx`, a link to a web page that opens in a new tab, as words or a button |
| `forms/` | `form-error.tsx`, the error line under a form |
| `hooks/` | `use-action.ts`: an action's busy state and its error |
| `frame/` | What the Handheld frame offers its pages (`handheld.ts`: the layout, the dock), and Talk: the talk strip and Talk key (`talk-strip.tsx`), listening (`speech.ts`) and keeping the screen awake (`wake-lock.ts`), and the frame's buttons (`frame-button.tsx`) |
| `reply/` | The Reply box (`reply-box.tsx`, #251) with its chips (`attachment.tsx`, `skill-tag.tsx`), the skills it picks from (`skill-list.tsx`), its model choice (`model-pickers.tsx`, `models.ts`) and its attachments (`attaching.ts`) |
| `answer/` | How an answer's Markdown looks (#753): `markdown.tsx`, its elements and a finished answer formatted (`MarkdownAnswer`, which Fabrication's chat uses); `table.tsx`, a table that sorts by its columns (ADR 0021), with how cells sort (`sorting.ts`), its headings' sort button (`sort-button.tsx`) and reading Markdown's elements (`hast.ts`). The web app's answer renderer adds its fences, maths and streaming to the elements, and draws each table in a `RichBlock` |

- **Uses:** React, `lucide-react`, Figtree, `react-markdown` with `remark-gfm` for answers, and `@courtyard/contract` for the shapes of models, skills and messages.
- **Used by:** both apps. An app imports a piece by its path (`@courtyard/ui/layout/page.tsx`) and the theme in its
  own stylesheet, after Tailwind, with the package as a source of classes:

  ```css
  @import "tailwindcss";
  @import "@courtyard/ui/theme.css";
  @source "../../../packages/ui";
  ```

  The web app leaves an answer's table and its sort button out of its first load and takes them into its rich blocks'
  stylesheet instead (`styles.css`, `rich-blocks.css`).

- **The Reply box's sheets are the app's own.** Its Skills and Model sheets save a default model to the worker, so an
  app passes them in, lazily, as `choices` (`reply-choices.ts`); the web app's are
  `features/sessions/composer/handheld-choices.tsx`.
- **Checked as the apps are:** `scripts/theme/check.ts` reads it with the web app's source, and `scripts/folders/check.ts`
  keeps it to the folders above.
