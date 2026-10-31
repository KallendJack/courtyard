import { z } from "zod";

// A code workspace's Designs tab (#522): its Paper file's boards, row by row, as the worker last
// exported them. Only that tab parses these, so they stay off the first load.

/** The pages the tab shows, in its picker's order: the file's own `1 · Live`, `2 · Agreed`, `3 · Drafts`. */
export const DESIGN_PAGES = ["live", "agreed", "drafts"] as const;
export const DesignPageKind = z.enum(DESIGN_PAGES);
export type DesignPageKind = z.infer<typeof DesignPageKind>;

/** The device a board is drawn for, read from its name; `other` for a style guide or a component. */
export const DesignDevice = z.enum(["desktop", "tablet", "cover", "other"]);
export type DesignDevice = z.infer<typeof DesignDevice>;

/**
 * One board: its id in Paper, its full name, what its row calls it (its device, when the row is its
 * screen's), its device, its true size in Paper, and its picture's name, which changes whenever the
 * picture does.
 */
export const DesignBoard = z.object({
  id: z.string().min(1),
  name: z.string(),
  label: z.string(),
  device: DesignDevice,
  width: z.number().positive(),
  height: z.number().positive(),
  picture: z.string().regex(/^[0-9a-f]{16,64}$/),
});
export type DesignBoard = z.infer<typeof DesignBoard>;

/** One row: a `Section · <area>` board's area and the boards beside it, Desktop, Tablet, Cover. */
export const DesignRow = z.object({ area: z.string(), boards: z.array(DesignBoard) });
export type DesignRow = z.infer<typeof DesignRow>;

/** One page's rows, in the file's order, with how many boards they hold. */
export const DesignPage = z.object({
  kind: DesignPageKind,
  count: z.number().int().nonnegative(),
  rows: z.array(DesignRow),
});
export type DesignPage = z.infer<typeof DesignPage>;

/**
 * A code workspace's Paper file's boards (#522), as last exported: every page in the picker's
 * order (empty until the first export), when they were exported, whether an export is running
 * now, and whether the last try reached Paper (it exports only while it's open on the worker
 * machine; the last pictures stay either way).
 */
export const Designs = z.object({
  fileId: z.string(),
  pages: z.array(DesignPage),
  exportedAt: z.iso.datetime().nullable(),
  exporting: z.boolean(),
  reached: z.boolean(),
});
export type Designs = z.infer<typeof Designs>;
