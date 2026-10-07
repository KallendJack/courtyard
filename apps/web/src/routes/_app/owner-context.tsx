import { createFileRoute, Link } from "@tanstack/react-router";
import { Page, PageTitle } from "@/components/page";
import { RecentChanges } from "../../changes/recent-changes.tsx";

export const Route = createFileRoute("/_app/owner-context")({
  component: OwnerContextChanges,
});

/**
 * The owner context's Recent changes, on a page of its own: on the home page, the list's code
 * would push the first load past its budget.
 */
function OwnerContextChanges() {
  return (
    <Page>
      <PageTitle
        above={
          <Link to="/" className="w-fit text-xs font-medium text-primary-text hover:underline">
            Workspaces
          </Link>
        }
      >
        Owner context
      </PageTitle>
      <p className="mt-2 text-[15px]/[23px] text-muted-foreground">
        What's changed in what every workspace knows about you, newest first.
      </p>
      <div className="mt-8">
        <RecentChanges about={{ kind: "owner" }} />
      </div>
    </Page>
  );
}
