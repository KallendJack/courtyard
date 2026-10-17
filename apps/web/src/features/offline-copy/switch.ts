import { useSyncExternalStore } from "react";

// Read offline's switch (#106), on the first load: each device's own, kept on the device and off
// by default. The worker keeps no list of the devices that hold a copy.

const KEY = "courtyard-read-offline";
const listeners = new Set<() => void>();

/** Whether this device keeps a copy to read offline. */
export const keepsCopy = () => {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
};

/** Turns this device's copy on or off; what's kept is wiped by whoever turns it off. */
export const setKeepsCopy = (on: boolean) => {
  if (on) localStorage.setItem(KEY, "on");
  else localStorage.removeItem(KEY);
  for (const listener of listeners) listener();
};

const subscribe = (changed: () => void) => {
  listeners.add(changed);
  return () => listeners.delete(changed);
};

/** Whether this device keeps a copy, followed as it's turned on and off. */
export const useKeepsCopy = () => useSyncExternalStore(subscribe, keepsCopy);

/**
 * Wipes this device's copy, if it keeps one: on logging out here, on hearing it was logged out
 * elsewhere, and on turning the switch off. Its code loads only then.
 */
export const wipeCopyHere = async () => {
  const store = await import("./store.ts");
  await store.wipeCopy();
};
