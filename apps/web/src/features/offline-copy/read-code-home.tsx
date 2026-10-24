import type { CodeSessionList } from "@courtyard/contract";
import { CARD, Page, SectionTitle } from "@courtyard/ui/layout/page.tsx";
import type { ReactNode } from "react";
import { NotKept, OfflineLine } from "@/components/layout/offline";
import type { OfflinePage } from "../../api/workspace-page.ts";
import { SessionLinks } from "../sessions/session-links.tsx";

/**
 * A code workspace's page read from the device's copy (#106): its sessions, the ones whose
 * conversations aren't kept faint, and one quiet line for the rest of its Home (what waits on the
 * owner, what's running, Next up, main and its pull requests), none of which is kept. In place of
 * the message box, the grey line saying it's a copy.
 */
export function ReadCodeHome(props: {
  header: ReactNode;
  list: CodeSessionList;
  offline: OfflinePage;
}) {
  const { offline } = props;
  return (
    <Page
      wide
      header={props.header}
      footer={
        <div className="pt-2 pb-3 md:pb-6">
          <OfflineLine at={offline.at} />
        </div>
      }
    >
      <div className="mt-4 flex flex-col gap-3.5">
        <SessionLinks list={props.list} mode="code" kept={offline.conversations} />
        <section aria-label="Home" className={CARD}>
          <SectionTitle>Home</SectionTitle>
          <NotKept />
        </section>
      </div>
    </Page>
  );
}
