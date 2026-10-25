import type { BuildSlug, MadePart } from "@courtyard/contract";
import type { Context, Hono } from "hono";
import { apiError } from "../../lib/http.ts";
import { err, ok, type Result } from "../../lib/result.ts";
import type { ReadBuild } from "./index.ts";
import { createPrints, filesOf, madePartOf, type PrintRefusal } from "./print.ts";

// A printed part's routes (#702), on Fabrication's: the part made, and its files to print.

/** Why a printed part wasn't made, as the API answers it. */
const printError = (c: Context, refusal: PrintRefusal) => {
  switch (refusal.kind) {
    case "not-printed":
      return apiError(c, { status: 404, error: "That Build isn't a printed part." });
    case "cannot-make":
      return apiError(c, {
        status: 422,
        error: `That part can't be made as it is: ${refusal.problems.join(" ")}`,
      });
    case "too-long":
      return apiError(c, {
        status: 503,
        error: "Making that part took too long, so it was stopped: make it simpler.",
      });
    case "stopped":
      return apiError(c, { status: 503, error: "Making that part was stopped." });
    case "failed":
      return apiError(c, { status: 500, error: "That part couldn't be made just now." });
  }
};

/** A printed part's routes on `routes`, each reading its Build with `opened`. */
export const printRoutes = (
  routes: Hono,
  target: {
    /** A Build as read, by the request's workspace and Build, or the answer why not. */
    opened: (
      c: Context,
    ) => Promise<
      Result<{ build: ReadBuild; place: { workspace: { id: string } }; slug: BuildSlug }, Response>
    >;
    /** How a printed part's solid and files are made: the builds lock, and a time limit. */
    printing: Parameters<typeof createPrints>[0];
  },
) => {
  const { opened } = target;
  const prints = createPrints(target.printing);

  /** A printed part's Build made, by the request's workspace and Build, or the answer why not. */
  const madePrint = async (c: Context) => {
    const found = await opened(c);
    if (!found.ok) return found;
    const { build, place, slug } = found.value;
    const made = await prints.make(`${place.workspace.id}/${slug}`, build, c.req.raw.signal);
    if (made.ok) return ok({ made: made.value, slug });
    return err(printError(c, made.error));
  };

  // A printed part made: its size and volume from the solid, its triangles for the 3D view, and
  // its files' names.
  routes.get("/workspaces/:id/builds/:slug/print", async (c) => {
    const made = await madePrint(c);
    if (!made.ok) return made.error;
    const { slug } = made.value;
    return c.json(madePartOf(made.value.made, filesOf(slug)) satisfies MadePart);
  });

  // Its files to print, by their names: the 3MF Bambu Studio opens, and the STL.
  routes.get("/workspaces/:id/builds/:slug/print/:file", async (c) => {
    const made = await madePrint(c);
    if (!made.ok) return made.error;
    const files = filesOf(made.value.slug);
    const file = c.req.param("file");
    const bytes =
      file === files.threeMf
        ? { body: made.value.made.threeMf, type: "model/3mf" }
        : file === files.stl
          ? { body: made.value.made.stl, type: "model/stl" }
          : undefined;
    if (bytes === undefined) return apiError(c, { status: 404, error: "There's no such file." });
    return c.body(new Uint8Array(bytes.body), 200, {
      "Content-Type": bytes.type,
      "Content-Disposition": `attachment; filename="${file}"`,
    });
  });
};
