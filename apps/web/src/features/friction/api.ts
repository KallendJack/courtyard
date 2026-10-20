import {
  ATTACHMENTS_FIELD,
  FrictionPlace,
  type FrictionReport,
  MESSAGE_FIELD,
  SessionSummary,
} from "@courtyard/contract";
import { sendForm } from "../../api/send-form.ts";
import { fromWorker } from "../../api/worker.ts";

// Something's off's calls (#554), with its sheet, so they stay off the first load.

/** Where a report goes, and the version running. */
export const loadPlace = () => fromWorker("/friction", FrictionPlace);

/** Files a report, with the screen when it could be taken: answers with the session filing it. */
export const fileReport = (report: FrictionReport, screen: Blob | undefined) => {
  const form = new FormData();
  form.set(MESSAGE_FIELD, JSON.stringify(report));
  if (screen !== undefined) {
    form.append(ATTACHMENTS_FIELD, new File([screen], "screen.jpg", { type: screen.type }));
  }
  return sendForm({ path: "/friction", form, schema: SessionSummary });
};
