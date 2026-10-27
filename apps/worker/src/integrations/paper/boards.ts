import { z } from "zod";
import { err, ok, type Result } from "../../lib/result.ts";
import type { AskPaper, PaperPicture } from "./client.ts";

/**
 * A Paper file's boards with their pictures, for a code workspace's Designs tab (#522): each page
 * the caller wants, its boards where they sit and how big they are, and a screenshot of each.
 */

/** One board on a page: where it sits on the canvas, its size in Paper, and its picture. */
export type PaperBoard = {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly picture: PaperPicture;
};

/** One page of a file, by its name, with its boards. */
export type PaperPage = { readonly name: string; readonly boards: readonly PaperBoard[] };

/** `get_basic_info`'s answer, as far as Courtyard reads it: the file's pages, or a page's boards. */
const Info = z.looseObject({
  pages: z.array(z.looseObject({ type: z.string(), id: z.string(), name: z.string() })),
  artboards: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string(),
        width: z.number().nullable(),
        height: z.number().nullable(),
        worldX: z.number().nullable(),
        worldY: z.number().nullable(),
      }),
    )
    .optional(),
});
type Info = z.infer<typeof Info>;

/** The first of an answer's text parts that reads as `get_basic_info`'s. */
const infoIn = (texts: readonly string[]): Info | undefined => {
  for (const text of texts) {
    try {
      const info = Info.safeParse(JSON.parse(text));
      if (info.success) return info.data;
    } catch {
      // Not JSON: the next part may be.
    }
  }
  return undefined;
};

/**
 * A picture's size in pixels, from its own header: a PNG's or a JPEG's (Paper's screenshots are
 * one or the other). Used for a board whose size Paper leaves out (one that fits its content).
 */
export const pictureSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && view.getUint32(0) === 0x89504e47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  let at = 2;
  while (bytes[0] === 0xff && bytes[1] === 0xd8 && at + 9 < bytes.length) {
    const marker = view.getUint16(at);
    // A frame's start (SOF0 to SOF15, but not DHT, JPG or DAC) holds the size.
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return { width: view.getUint16(at + 7), height: view.getUint16(at + 5) };
    }
    at += 2 + view.getUint16(at + 2);
  }
  return undefined;
};

/** How big a board is: Paper's size where it gives one, else its picture's shape at its width. */
const sizeOf = (board: { width: number | null; height: number | null }, picture: PaperPicture) => {
  const drawn = pictureSize(picture.bytes);
  const width = board.width ?? drawn?.width;
  if (width === undefined) return undefined;
  const height =
    board.height ?? (drawn === undefined ? undefined : (width * drawn.height) / drawn.width);
  return height === undefined ? undefined : { width, height };
};

/** Exports the boards on each page of `fileId` that `wanted` names, in one ask of Paper. */
export const exportBoards = async (
  ask: AskPaper,
  file: { readonly fileId: string; readonly wanted: (page: string) => boolean },
): Promise<Result<readonly PaperPage[], string>> => {
  const { fileId } = file;
  const unreadable = err("Paper's pages couldn't be read.");
  const basic = await ask("get_basic_info", { fileId });
  if (!basic.ok) return basic;
  const pages = infoIn(basic.value.texts)?.pages;
  if (pages === undefined) return unreadable;
  const exported: PaperPage[] = [];
  for (const page of pages) {
    if (page.type !== "page" || !file.wanted(page.name)) continue;
    const info = await ask("get_basic_info", { fileId, pageId: page.id });
    if (!info.ok) return info;
    const artboards = infoIn(info.value.texts)?.artboards;
    if (artboards === undefined) return unreadable;
    const boards: PaperBoard[] = [];
    for (const artboard of artboards) {
      const shot = await ask("get_screenshot", { fileId, nodeId: artboard.id, scale: 1 });
      if (!shot.ok) return shot;
      const picture = shot.value.pictures[0];
      const size = picture === undefined ? undefined : sizeOf(artboard, picture);
      // A board Paper didn't picture, or whose size can't be known, is left out.
      if (picture === undefined || size === undefined) continue;
      boards.push({
        id: artboard.id,
        name: artboard.name,
        x: artboard.worldX ?? 0,
        y: artboard.worldY ?? 0,
        ...size,
        picture,
      });
    }
    exported.push({ name: page.name, boards });
  }
  return ok(exported);
};
