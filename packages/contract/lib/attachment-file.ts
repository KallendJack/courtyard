import { z } from "zod";
import { PDF_TYPE, PHOTO_TYPES, type PhotoMediaType } from "./attachment.ts";

// Attaching a file (#78): the limits, and the checks the browser makes and the worker makes again.
// Apart from `attachment.ts`, which every session event needs, so none of this is on the first load.

/**
 * The limits on attachments: at most five per message, each up to 20 MB; photos shrunk in the
 * browser to about 2000 px on their long side; and the session's last ten go with each turn.
 */
export const ATTACHMENTS = {
  perMessage: 5,
  maxBytes: 20 * 1024 * 1024,
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
