import type { PaperFile } from "@courtyard/contract";
import { err, ok } from "../../lib/result.ts";
import { PAPER_NOT_OPEN, type PaperFiles } from "./files.ts";

/**
 * For tests only: the owner's Paper files in memory (#308), so connecting Paper from a code
 * workspace's page is tested without Paper. `close` makes it act as Paper does when it isn't
 * open on the worker machine.
 */
export const createFakePaperFiles = (options: { files?: readonly PaperFile[] } = {}) => {
  const files: PaperFile[] = [...(options.files ?? [])];
  let open = true;
  /** The command each ask was made with, in order, as a test checks which Paper was asked. */
  const asked: string[] = [];
  let made = 0;

  const paper: PaperFiles = {
    list: async (command) => {
      asked.push(command);
      return open ? ok([...files]) : err(PAPER_NOT_OPEN);
    },
    create: async (command, name) => {
      asked.push(command);
      if (!open) return err(PAPER_NOT_OPEN);
      made += 1;
      const file = { id: `new-file-${made}`, name };
      files.unshift(file);
      return ok(file);
    },
  };
  return {
    paper,
    /** Paper is closed on the worker machine now, or open again. */
    setOpen: (now: boolean) => {
      open = now;
    },
    /** The files Paper has now, newest first. */
    files: () => [...files],
    asked: () => [...asked],
  };
};

export type FakePaperFiles = ReturnType<typeof createFakePaperFiles>;
