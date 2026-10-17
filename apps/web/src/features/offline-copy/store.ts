import { OfflineCopy } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { z } from "zod";

// Where the device keeps its copy (#106): IndexedDB, the copy whole as the worker gave it, read
// back through its schema like anything else from a disk. Never sent back, never changed here.
// Not encrypted: a key would live on the same device, so the phone's lock and storage encryption
// are what keep it.

const DATABASE = "courtyard";
const STORE = "offline-copy";
const KEY = "copy";

const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Does `act` on the store in one transaction, once it has completed. */
const inStore = async <T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = act(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
};

/** The copy this device keeps, or none: none kept, or one this app can no longer read. */
export const readCopy = async (): Promise<OfflineCopy | undefined> => {
  try {
    const parsed = OfflineCopy.safeParse(await inStore("readonly", (store) => store.get(KEY)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/** When the copy this device keeps is from, without reading all of it. */
const readAt = async () => {
  try {
    const kept = z
      .object({ at: z.iso.datetime() })
      .safeParse(await inStore("readonly", (store) => store.get(KEY)));
    return kept.success ? kept.data.at : undefined;
  } catch {
    return undefined;
  }
};

/** Keeps `copy` in place of the one before. */
export const keepCopy = async (copy: OfflineCopy) => {
  await inStore("readwrite", (store) => store.put(copy, KEY));
  changed();
};

/** Wipes the copy, if there is one. */
export const wipeCopy = async () => {
  try {
    await inStore("readwrite", (store) => store.delete(KEY));
  } catch {
    // No database at all: nothing kept to wipe.
  }
  changed();
};

/** When the copy this device keeps is from, followed as it's updated and wiped; `undefined` while there's none. */
export const useCopyAt = () => {
  const [at, setAt] = useState<string>();
  useEffect(() => {
    let current = true;
    const read = () =>
      void readAt().then((now) => {
        if (current) setAt(now);
      });
    read();
    listeners.add(read);
    return () => {
      current = false;
      listeners.delete(read);
    };
  }, []);
  return at;
};
