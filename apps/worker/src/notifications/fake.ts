import { err, ok } from "../result.ts";
import type { SendPush } from "./index.ts";

/**
 * For tests only: a push service in memory (#173). It keeps every notification sent, by the
 * device's endpoint and what it carried, read back as JSON; `unsubscribe` makes one device's
 * subscription gone, as a browser unsubscribing or a subscription expiring does, and each send to
 * it is then refused, kept by its endpoint.
 */
export const createFakePush = () => {
  const sent: { endpoint: string; payload: unknown }[] = [];
  const refused: string[] = [];
  const gone = new Set<string>();
  const send: SendPush = async ({ subscription, payload }) => {
    if (gone.has(subscription.endpoint)) {
      refused.push(subscription.endpoint);
      return err("gone");
    }
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    return ok(null);
  };
  return {
    send,
    sent,
    refused,
    unsubscribe: (endpoint: string) => {
      gone.add(endpoint);
    },
  };
};

export type FakePush = ReturnType<typeof createFakePush>;
