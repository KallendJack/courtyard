import { z } from "zod";
import { PDF_TYPE, PHOTO_TYPES, type PhotoMediaType } from "./attachment.ts";

// Attaching a file (#78): the limits, and the checks the browser makes and the worker makes again.
// Apart from `attachment.ts`, which every session event needs, so none of this is on the first load.

/** A megabyte, as the limits count them. */
const MB = 1024 * 1024;

/**
 * The limits on attachments: at most five per message; a PDF up to 20 MB; a photo up to 3.75 MB,
 * since Claude takes an image only up to 5 MB once it's base64-encoded for sending (Codex takes
 * more), and a photo the browser has shrunk to about 2000 px on its long side is well under that;
 * and the session's last ten go with each turn.
 */
export const ATTACHMENTS = {
  perMessage: 5,
  pdfMaxBytes: 20 * MB,
  photoMaxBytes: 3.75 * MB,
  photoLongSide: 2000,
  carried: 10,
} as const;

export const AttachmentMediaType = z.enum([...PHOTO_TYPES, PDF_TYPE]);
export type AttachmentMediaType = z.infer<typeof AttachmentMediaType>;

/** A file's kind and media type as its attachment records them: a photo or a PDF. */
export const attachmentType = (
  mediaType: AttachmentMediaType,
): { kind: "photo"; mediaType: PhotoMediaType } | { kind: "pdf"; mediaType: typeof PDF_TYPE } =>
  mediaType === PDF_TYPE ? { kind: "pdf", mediaType } : { kind: "photo", mediaType };

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
    const known = AttachmentMediaType.safeParse(type);
    const isPdf = known.success && known.data === PDF_TYPE;
    const problem = !known.success
      ? `${name} can't be attached: only photos and PDFs.`
      : isPdf && size > ATTACHMENTS.pdfMaxBytes
        ? `${name} is over ${ATTACHMENTS.pdfMaxBytes / MB} MB.`
        : !isPdf && size > ATTACHMENTS.photoMaxBytes
          ? `${name} is over ${ATTACHMENTS.photoMaxBytes / MB} MB, the largest photo every model takes.`
          : size === 0
            ? `${name} is empty.`
            : undefined;
    if (problem !== undefined) ctx.addIssue({ code: "custom", message: problem });
  });
export type AttachmentFile = z.infer<typeof AttachmentFile>;

/** Why a sixth attachment can't go. */
export const TOO_MANY_ATTACHMENTS = `Only ${ATTACHMENTS.perMessage} photos or PDFs go with a message.`;
