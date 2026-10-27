import type { BuildSizes, WorkspaceId } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { ThingSizesBlock } from "./size-lines.tsx";

/**
 * The sizes a Build's steps need (#709), on its page: the same lines its space shows, each with
 * where it came from, and a link to the space's page to measure or correct them. Read with the
 * Build, so nothing comes in late; nothing shows for a Build whose steps need no size.
 */
export function BuildSizesBlock(props: { workspaceId: WorkspaceId; sizes: BuildSizes }) {
  const now = Date.now();
  return (
    <>
      {props.sizes.spaces.map((space) => (
        <div key={space.thing.slug} className="flex flex-col gap-1">
          <ThingSizesBlock sizes={space} now={now} level={3} />
          <Link
            to="/workspaces/$id/spaces/$slug"
            params={{ id: props.workspaceId, slug: space.thing.slug }}
            className="flex items-center gap-0.5 self-end px-1 text-meta font-medium text-primary-text hover:underline"
          >
            Measure in the {space.thing.name.toLowerCase()}
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        </div>
      ))}
    </>
  );
}
