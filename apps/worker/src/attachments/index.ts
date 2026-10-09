import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  ATTACHMENTS,
  type Attachment,
  AttachmentFile,
  AttachmentId,
  AttachmentMediaType,
  attachmentKind,
  type SessionEvent,
  TOO_MANY_ATTACHMENTS,
} from "@courtyard/contract";
import { extractText, getDocumentProxy } from "unpdf";
import { entryAt, readTextFile, writeBytes, writeTextFile } from "../files.ts";
import { err, ok, type Result } from "../result.ts";

/** An attachment checked and ready to keep: what the owner's message records, its bytes, and a PDF's text. */
export type PreparedAttachment = {
  readonly attachment: Attachment;
  readonly bytes: Uint8Array;
  readonly text: string | undefined;
};

/** An attachment as a turn passes it on: a photo's file, or a PDF's text (#78). */
export type TurnAttachment =
  | {
      readonly kind: "photo";
      readonly name: string;
      readonly path: string;
      readonly mediaType: AttachmentMediaType;
    }
  | { readonly kind: "pdf"; readonly name: string; readonly text: string };

/** How each kind of file starts, so a file is what its type says before it's kept or served. */
const STARTS: Readonly<Record<AttachmentMediaType, (bytes: Uint8Array) => boolean>> = {
  "image/jpeg": (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  "image/png": (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/gif": (bytes) => ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a",
  "image/webp": (bytes) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
  "application/pdf": (bytes) => ascii(bytes, 0, 5) === "%PDF-",
};

const startsWith = (bytes: Uint8Array, start: readonly number[]) =>
  start.every((byte, index) => bytes[index] === byte);

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

/** Each kind's file ending in the session's folder. */
const ENDINGS: Readonly<Record<AttachmentMediaType, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

/** A file's name as the chat shows it: on one line, without any folders, never empty. */
const cleanName = (name: string) => {
  const last = name.split(/[\\/]/).at(-1) ?? "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's removed
  const plain = last.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return plain === "" ? "attachment" : plain.slice(0, 255);
};

/** Why a PDF with no text in it can't go. */
const noTextIn = (name: string) =>
  `${name} has no text a model can read: it's probably a scan. Send a photo of the page instead.`;

/** A PDF's text, every page's, or `undefined` when it can't be read. */
const pdfText = async (bytes: Uint8Array): Promise<string | undefined> => {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return undefined;
  }
};

/**
 * Checks the files sent with a message (#78), as the browser did: at most five, each a photo or a
 * PDF up to 20 MB, and each really the kind it says. A PDF's text is pulled out here, and a PDF
 * with none is refused. Answers with the first reason one can't go.
 */
export const prepareAttachments = async (
  files: readonly File[],
): Promise<Result<PreparedAttachment[], string>> => {
  if (files.length > ATTACHMENTS.perMessage) return err(TOO_MANY_ATTACHMENTS);
  const prepared: PreparedAttachment[] = [];
  for (const file of files) {
    const name = cleanName(file.name);
    const checked = AttachmentFile.safeParse({ name, type: file.type, size: file.size });
    const type = AttachmentMediaType.safeParse(file.type);
    if (!checked.success || !type.success) {
      return err(checked.error?.issues[0]?.message ?? `${name} can't be attached.`);
    }
    const mediaType = type.data;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!STARTS[mediaType](bytes)) return err(`${name} isn't the kind of file its name says.`);
    const kind = attachmentKind(mediaType);
    const text = kind === "pdf" ? await pdfText(bytes) : undefined;
    if (kind === "pdf" && text === undefined) return err(`${name} can't be read as a PDF.`);
    if (kind === "pdf" && text?.trim() === "") return err(noTextIn(name));
    const attachment: Attachment = {
      id: AttachmentId.parse(randomUUID()),
      name,
      kind,
      mediaType,
      size: bytes.length,
    };
    prepared.push({ attachment, bytes, text });
  }
  return ok(prepared);
};

const folderIn = (sessionFolder: string) => join(sessionFolder, "attachments");

/** Where an attachment is kept in its session's folder. */
export const attachmentPath = (sessionFolder: string, attachment: Attachment) =>
  join(folderIn(sessionFolder), `${attachment.id}${ENDINGS[attachment.mediaType]}`);

/** Where a PDF's text is kept, beside it, so later turns don't read the PDF again. */
const textPath = (sessionFolder: string, attachment: Attachment) =>
  join(folderIn(sessionFolder), `${attachment.id}.txt`);

/** Keeps a message's attachments in its session's folder, which takes them with it when it goes. */
export const keepAttachments = async (
  sessionFolder: string,
  prepared: readonly PreparedAttachment[],
): Promise<Result<null, "unwritable">> => {
  if (prepared.length === 0) return ok(null);
  try {
    await mkdir(folderIn(sessionFolder), { recursive: true });
  } catch {
    return err("unwritable");
  }
  for (const { attachment, bytes, text } of prepared) {
    const kept = await writeBytes(attachmentPath(sessionFolder, attachment), bytes);
    if (!kept.ok) return kept;
    if (text !== undefined) {
      const written = await writeTextFile(textPath(sessionFolder, attachment), text);
      if (!written.ok) return written;
    }
  }
  return ok(null);
};

/** Every attachment a session's owner messages carried, each once, oldest first. */
export const attachmentsOf = (events: readonly SessionEvent[]): Attachment[] => {
  const seen = new Map<string, Attachment>();
  for (const event of events) {
    if (event.type !== "owner-message") continue;
    for (const attachment of event.attachments ?? []) {
      seen.delete(attachment.id);
      seen.set(attachment.id, attachment);
    }
  }
  return [...seen.values()];
};

/**
 * What a turn carries (#78): the session's last ten attachments, oldest first, each photo by its
 * file and each PDF by its text. One that's gone from the folder is left out.
 */
export const carriedAttachments = async (
  sessionFolder: string,
  events: readonly SessionEvent[],
): Promise<TurnAttachment[]> => {
  const carried = attachmentsOf(events).slice(-ATTACHMENTS.carried);
  const found = await Promise.all(
    carried.map(async (attachment): Promise<TurnAttachment[]> => {
      if (attachment.kind === "photo") {
        const path = attachmentPath(sessionFolder, attachment);
        const there = await entryAt(path);
        return there.ok && there.value?.kind === "file"
          ? [{ kind: "photo", name: attachment.name, path, mediaType: attachment.mediaType }]
          : [];
      }
      const text = await readTextFile(textPath(sessionFolder, attachment));
      return text.ok && text.value !== undefined
        ? [{ kind: "pdf", name: attachment.name, text: text.value }]
        : [];
    }),
  );
  return found.flat();
};
