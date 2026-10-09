import { z } from "zod";

/**
 * The limits on attachments (#78): at most five per message, each up to 20 MB; photos shrunk in
 * the browser to about 2000 px on their long side; and the session's last ten go with each turn.
 */
export const ATTACHMENTS = {
  perMessage: 5,
  maxBytes: 20 * 1024 * 1024,
  photoLongSide: 2000,
  carried: 10,
} as const;

/** The kinds of photo a model takes. The browser sends every photo as JPEG, HEIC included. */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const PDF_TYPE = "application/pdf";

export const PhotoMediaType = z.enum(PHOTO_TYPES);
export type PhotoMediaType = z.infer<typeof PhotoMediaType>;

export const AttachmentMediaType = z.enum([...PHOTO_TYPES, PDF_TYPE]);
export type AttachmentMediaType = z.infer<typeof AttachmentMediaType>;

/** A photo or a PDF, by its media type. */
export const attachmentKind = (mediaType: AttachmentMediaType) =>
  mediaType === PDF_TYPE ? ("pdf" as const) : ("photo" as const);

/** The longest file name kept. */
const NAME_MAX_LENGTH = 255;

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

export const AttachmentId = z.uuid().brand<"AttachmentId">();
export type AttachmentId = z.infer<typeof AttachmentId>;

/** An attachment as the owner's message records it: kept in the session's folder by its id. */
export const Attachment = z.object({
  id: AttachmentId,
  name: z.string().min(1).max(NAME_MAX_LENGTH),
  kind: z.enum(["photo", "pdf"]),
  mediaType: AttachmentMediaType,
  size: z.number().int().positive().max(ATTACHMENTS.maxBytes),
});
export type Attachment = z.infer<typeof Attachment>;

/** The multipart field a message's JSON goes in when it carries attachments, and its files' field. */
export const MESSAGE_FIELD = "message";
export const ATTACHMENTS_FIELD = "attachments";
