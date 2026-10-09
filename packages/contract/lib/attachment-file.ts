import { z } from "zod";
import { ATTACHMENTS, AttachmentMediaType, PDF_TYPE, PHOTO_TYPES } from "./attachment.ts";

// Checking a file before it's attached (#78), in the browser and again in the worker. Apart from
// `attachment.ts`, which every session event needs, so none of this reaches the first load.

export const PhotoMediaType = z.enum(PHOTO_TYPES);
export type PhotoMediaType = z.infer<typeof PhotoMediaType>;

/** A photo or a PDF, by its media type. */
export const attachmentKind = (mediaType: AttachmentMediaType) =>
  mediaType === PDF_TYPE ? ("pdf" as const) : ("photo" as const);

/** A file's size the way the owner reads it: "2.4 MB", "820 KB". */
export const sizeInWords = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * A file the owner wants to attach, as the browser and the worker both check it: a photo or a
 * PDF, and not too big. Each refusal names the file.
 */
export const AttachmentFile = z
  .object({ name: z.string(), type: z.string(), size: z.number().int().nonnegative() })
  .superRefine(({ name, type, size }, ctx) => {
    const problem = !AttachmentMediaType.safeParse(type).success
      ? `${name} can't be attached: only photos and PDFs.`
      : size > ATTACHMENTS.maxBytes
        ? `${name} is over ${ATTACHMENTS.maxBytes / (1024 * 1024)} MB.`
        : size === 0
          ? `${name} is empty.`
          : undefined;
    if (problem !== undefined) ctx.addIssue({ code: "custom", message: problem });
  });
export type AttachmentFile = z.infer<typeof AttachmentFile>;

/** Why a sixth attachment can't go. */
export const TOO_MANY_ATTACHMENTS = `Only ${ATTACHMENTS.perMessage} photos or PDFs go with a message.`;
