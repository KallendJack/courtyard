import type { Page } from "@playwright/test";

// What the specs that check nothing moves once drawn (#283) share: layout-shift.spec.ts's main
// pages, and the Builders board loading late (builders-board.spec.ts, #592).

/**
 * Adds up every layout shift the page reports from the start, outside the owner's own input. Rows
 * coming and going inside a block's own scrolling area are its content, not the page moving (owner
 * on #283: rows appear inside a block's own area, so nothing else moves), so a shift of those
 * alone doesn't count.
 */
const watchShifts = (page: Page) =>
  page.addInitScript(() => {
    const seen: { value: number; sources: string[] }[] = [];
    (window as unknown as { shifts: typeof seen }).shifts = seen;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        const nodes = (entry.sources ?? []).map((source) => source.node);
        const inBlockRows = (node: Node | null | undefined) =>
          node instanceof Element && node.closest("section li") !== null;
        if (nodes.length > 0 && nodes.every(inBlockRows)) continue;
        const sources = (entry.sources ?? []).map((source) => {
          const node = source.node;
          if (!(node instanceof Element)) return String(node?.nodeName ?? "?");
          const label = node.getAttribute("aria-label") ?? node.textContent?.slice(0, 30) ?? "";
          return `${node.tagName.toLowerCase()}.${node.className.toString().slice(0, 40)} "${label}"`;
        });
        seen.push({ value: entry.value, sources });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

/** Opens `path`, waits for `ready`, then a moment for anything late, and gives what shifted. */
export const shiftsOn = async (page: Page, path: string, ready: (page: Page) => Promise<void>) => {
  await watchShifts(page);
  // As slow as a phone, or CI: what comes in late shows as late as it would there.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  await page.goto(path);
  await ready(page);
  await page.waitForTimeout(2500);
  return page.evaluate(
    () => (window as unknown as { shifts: { value: number; sources: string[] }[] }).shifts,
  );
};
