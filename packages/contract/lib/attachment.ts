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

export const AttachmentMediaType = z.enum([...PHOTO_TYPES, PDF_TYPE]);
export type AttachmentMediaType = z.infer<typeof AttachmentMediaType>;

/** The longest file name kept. */
const NAME_MAX_LENGTH = 255;

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
