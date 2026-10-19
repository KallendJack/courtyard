import { type BlockedShops, ShopUnblock, ThingSlug, type WantedList } from "@courtyard/contract";
import { type Context, Hono } from "hono";
import { apiError, contextError, readBody } from "../../lib/http.ts";
import { type ContextFolder, workspaceChange } from "../context-folder/index.ts";
import { fileIn, workspaceIn } from "../planning-files/routes.ts";
import { thingError } from "../things/routes.ts";
import { getWorkspace, unblockShop, type Workspace } from "../workspaces/index.ts";
import type { FindRefusal, Wanted } from "./index.ts";

/** Why picks weren't found, as the API answers it. */
const findError = (c: Context, refusal: FindRefusal) => {
  switch (refusal.kind) {
    case "not-wanted":
      return apiError(c, { status: 404, error: "That Thing isn't on the wanted list." });
    case "no-model":
      return apiError(c, {
        status: 409,
        error: "No model that checks prices on the web is available right now.",
      });
    default:
      return thingError(c, refusal);
  }
};

const blockedShopsOf = (workspace: Workspace): BlockedShops => ({
  shops: [...workspace.blockedShops],
});

/** A planning workspace's wanted list (#245), Find picks and its blocked shops, under `/api`. */
export const wantedRoutes = (target: {
  wanted: Wanted;
  contextDir: string;
  contextFolder: ContextFolder;
}) => {
  const routes = new Hono();
  const { wanted, contextDir, contextFolder } = target;

  routes.get("/workspaces/:id/wanted", async (c) => {
    const workspace = workspaceIn(c, {});
    if (workspace === undefined) return contextError(c, { kind: "not-found" });
    await wanted.opened(workspace.workspaceId);
    const list = await wanted.list(workspace.workspaceId);
    return list.ok ? c.json(list.value satisfies WantedList) : thingError(c, list.error);
  });

  routes.post("/workspaces/:id/wanted/:slug/find", async (c) => {
    const named = fileIn(c, {}, ThingSlug);
    if (named === undefined) return findError(c, { kind: "not-wanted" });
    const found = await wanted.find(named.workspace.workspaceId, named.slug);
    return found.ok ? c.json(found.value satisfies WantedList, 202) : findError(c, found.error);
  });

  routes.get("/workspaces/:id/blocked-shops", async (c) => {
    const workspace = await getWorkspace(contextDir, c.req.param("id"));
    if (!workspace.ok) return contextError(c, workspace.error);
    return c.json(blockedShopsOf(workspace.value));
  });

  routes.post("/workspaces/:id/blocked-shops/unblock", async (c) => {
    const body = await readBody(c, ShopUnblock);
    if (!body.ok) return apiError(c, { status: 400, error: body.error });
    const { shop } = body.value;
    const unblocked = await contextFolder.change(
      () => unblockShop(contextDir, { id: c.req.param("id"), shop }),
      (made) => workspaceChange(`Unblock shop: ${shop}`, made.summary.id),
    );
    if (!unblocked.ok) return contextError(c, unblocked.error);
    return c.json(blockedShopsOf(unblocked.value));
  });

  return routes;
};
