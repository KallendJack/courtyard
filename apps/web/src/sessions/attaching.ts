import { ATTACHMENTS, AttachmentFile, PDF_TYPE, TOO_MANY_ATTACHMENTS } from "@courtyard/contract";

/** A file in the message box's tray, ready to send, and its thumbnail while it's there. */
export type Attaching = {
  readonly key: string;
  readonly file: File;
  /** An object URL for a photo's thumbnail; revoked when it leaves the tray. */
  readonly preview: string | undefined;
};

/** How finely a shrunk photo is kept: plenty for a model to read, small on mobile data. */
const JPEG_QUALITY = 0.85;

/** A photo's name once it's a JPEG: "IMG_2041.HEIC" becomes "IMG_2041.jpg". */
const jpegName = (name: string) => `${name.replace(/\.[^./\\]+$/, "")}.jpg`;

/** Whether a file looks like a photo, iPhone HEIC included, which some browsers give no type. */
const looksLikePhoto = (file: File) =>
  file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);

/**
 * A photo shrunk to about 2000 px on its long side and re-encoded as JPEG (#78), HEIC included
 * where the browser can open it; `undefined` when it can't.
 */
const shrunk = async (file: File): Promise<File | undefined> => {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, ATTACHMENTS.photoLongSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    // A JPEG has no see-through parts: those become white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    return blob ? new File([blob], jpegName(file.name), { type: "image/jpeg" }) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Makes files the owner picked, pasted or dropped ready to send (#78): photos shrunk and turned
 * into JPEG, then each checked as the worker checks it. What can't go is left out, with why; so is
 * anything past the five a message takes, counting the `already` in the tray.
 */
export const prepareFiles = async (
  files: readonly File[],
  already: number,
): Promise<{ ready: Attaching[]; problems: string[] }> => {
  const ready: Attaching[] = [];
  const problems: string[] = [];
  let tooMany = false;
  for (const picked of files) {
    if (already + ready.length >= ATTACHMENTS.perMessage) {
      tooMany = true;
      continue;
    }
    const isPdf = picked.type === PDF_TYPE;
    const file = !isPdf && looksLikePhoto(picked) ? await shrunk(picked) : picked;
    if (file === undefined) {
      problems.push(`${picked.name} can't be attached: this browser can't open it.`);
      continue;
    }
    const checked = AttachmentFile.safeParse({ name: file.name, type: file.type, size: file.size });
    if (!checked.success) {
      problems.push(checked.error.issues[0]?.message ?? `${file.name} can't be attached.`);
      continue;
    }
    ready.push({
      key: crypto.randomUUID(),
      file,
      preview: isPdf ? undefined : URL.createObjectURL(file),
    });
  }
  if (tooMany) problems.push(TOO_MANY_ATTACHMENTS);
  return { ready, problems };
};

/** Lets go of the thumbnails of files leaving the tray. */
export const releasePreviews = (leaving: readonly Attaching[]) => {
  for (const { preview } of leaving) if (preview !== undefined) URL.revokeObjectURL(preview);
};
