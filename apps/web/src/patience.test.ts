import { describe, expect, it } from "vitest";
import { afterNoAnswer } from "./patience.ts";

// When the worker gives no answer (#204): a slow worker is tried again, quietly, for up to 30
// seconds; a refused connection or a network that's down is said straight away. `failed` is how
// long each try took to fail, oldest first.

describe("after a try the worker didn't answer", () => {
  it("says it can't be reached straight away when the device's network is down", () => {
    expect(afterNoAnswer({ failed: [3000], sinceFirstMs: 3000, online: false })).toEqual({
      kind: "unreachable",
    });
  });

  it("tries again soon after one quick failure, which a dropped connection can be", () => {
    expect(afterNoAnswer({ failed: [40], sinceFirstMs: 40, online: true })).toEqual({
      kind: "retry",
      afterMs: 250,
    });
  });

  it("says it can't be reached after three quick failures in a row: the connection is refused", () => {
    expect(afterNoAnswer({ failed: [30, 20, 25], sinceFirstMs: 850, online: true })).toEqual({
      kind: "unreachable",
    });
  });

  it("waits longer each time for a slow worker, up to 4 seconds between tries", () => {
    const waits = [1, 2, 3, 4, 5, 6].map((tries) =>
      afterNoAnswer({ failed: Array(tries).fill(3000), sinceFirstMs: 3000 * tries, online: true }),
    );

    expect(waits).toEqual(
      [250, 500, 1000, 2000, 4000, 4000].map((afterMs) => ({ kind: "retry", afterMs })),
    );
  });

  it("counts quick failures as refused only three in a row, not after a slow one", () => {
    expect(afterNoAnswer({ failed: [3000, 30, 30], sinceFirstMs: 4000, online: true })).toEqual({
      kind: "retry",
      afterMs: 1000,
    });
    expect(afterNoAnswer({ failed: [3000, 30, 30, 30], sinceFirstMs: 5000, online: true })).toEqual(
      { kind: "unreachable" },
    );
  });

  it("tries until 30 seconds have gone, then says it can't be reached", () => {
    const slow = Array(7).fill(3000);

    expect(afterNoAnswer({ failed: slow, sinceFirstMs: 29_000, online: true })).toEqual({
      kind: "retry",
      afterMs: 1000,
    });
    expect(afterNoAnswer({ failed: slow, sinceFirstMs: 30_000, online: true })).toEqual({
      kind: "unreachable",
    });
  });
});
