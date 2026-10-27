import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanningHome } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asOwner, type Requester, removeTestFolder, testWorker } from "./testing.ts";

// A planning workspace's Home (#603): its main subject, a Thing drawn as its kind of thing with
// its parts placed by name, or a room's floor plan; then its projects (projects.test.ts).

let root: string;
let contextDir: string;
const thingsDir = () => join(contextDir, "mountain-biking", "things");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "courtyard-"));
  contextDir = join(root, "context");
  await mkdir(join(contextDir, "mountain-biking"), { recursive: true });
  await writeFile(
    join(contextDir, "mountain-biking", "CONTEXT.md"),
    "# Mountain biking\n\n## Facts\n\n- Rides on Sundays.\n",
  );
});

afterEach(async () => {
  await removeTestFolder(root);
});

/** A Thing's file, from its front matter's lines. */
const thing = async (slug: string, ...lines: readonly string[]) => {
  await mkdir(thingsDir(), { recursive: true });
  await writeFile(join(thingsDir(), `${slug}.md`), `---\n${lines.join("\n")}\n---\n`);
};

/** A part of the hardtail, by its name, on its place on the drawing when it has one. */
const part = (slug: string, name: string, ...more: readonly string[]) =>
  thing(slug, `name: ${name}`, "status: have", "part of: hardtail", ...more);

/** The hardtail with its parts, each on its place, and a helmet that isn't one. */
const withBike = async () => {
  await thing("hardtail", "name: Boardman MHT 8.6", "status: have", "photo: photos/hardtail.jpg");
  await part("saddle", "Saddle", "place: saddle");
  await part("pedals", "Pedals", "place: pedals", "upcoming: DMR V8", "upcoming price: £60");
  await part("front-tyre", "Front tyre", "place: front-tyre");
  await part("rear-tyre", "Rear tyre", "place: rear-tyre");
  await part("drivetrain", "Drivetrain", "place: drivetrain");
  await part("bottle-cage", "Bottle cage");
  await thing("helmet", "name: Helmet", "status: have");
};

const home = async (request: Requester) => {
  const response = await request("/api/workspaces/mountain-biking/home");
  expect(response.status).toBe(200);
  return PlanningHome.parse(await response.json());
};

describe("a planning workspace's Home (#603)", () => {
  it("has no subject before the workspace has one", async () => {
    await thing("helmet", "name: Helmet", "status: have");
    const request = await asOwner(testWorker({ root }));

    expect(await home(request)).toEqual({ subject: null, projects: [] });
  });

  it("draws the Thing whose parts have places on the mountain bike, each on its place, an upcoming one with it, and lists the rest under it", async () => {
    await withBike();
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toEqual({
      kind: "drawing",
      drawing: "mountain-bike",
      thing: "hardtail",
      name: "Boardman MHT 8.6",
      // In the drawing's order: saddle, …, drivetrain, pedals, front tyre, rear tyre.
      placed: [
        { place: "saddle", thing: "saddle", name: "Saddle" },
        { place: "drivetrain", thing: "drivetrain", name: "Drivetrain" },
        { place: "pedals", thing: "pedals", name: "Pedals", upcoming: "DMR V8" },
        { place: "front-tyre", thing: "front-tyre", name: "Front tyre" },
        { place: "rear-tyre", thing: "rear-tyre", name: "Rear tyre" },
      ],
      unplaced: [{ thing: "bottle-cage", name: "Bottle cage" }],
    });
  });

  it("places parts by their place alone, never by the words in their names, one part to a place", async () => {
    await thing("whyte", "name: Whyte T-140", "status: have");
    const whyte = (slug: string, name: string, ...more: readonly string[]) =>
      thing(slug, `name: ${name}`, "status: have", "part of: whyte", ...more);
    await whyte("dropper", "OneUp dropper post", "place: seatpost");
    await whyte("cassette", "Cassette", "place: drivetrain");
    await whyte("chain", "KMC chain", "place: drivetrain");
    // Named as a place, but given none: it isn't placed by its name.
    await whyte("grips", "Grips");
    await whyte("tyres", "Tyres", "place: front-tyre");
    const request = await asOwner(testWorker({ root }));

    const subject = (await home(request)).subject;

    expect(subject).toMatchObject({
      kind: "drawing",
      placed: [
        { place: "seatpost", name: "OneUp dropper post" },
        // Cassette comes before the chain by name, so it has the drivetrain's place.
        { place: "drivetrain", name: "Cassette" },
        { place: "front-tyre", name: "Tyres" },
      ],
      unplaced: [{ name: "Grips" }, { name: "KMC chain" }],
    });
  });

  it("draws only fitted parts: a wanted one is neither on the bike nor under it (the owner's pedals, #603)", async () => {
    await thing("hardtail", "name: Boardman MHT 8.6", "status: have");
    await part("saddle", "Saddle", "place: saddle");
    // As the owner's real files have them: the wanted DMR V8s beside the fitted Wellgo flats.
    await thing(
      "dmr-v8-pedals",
      "name: DMR V8 pedals",
      "status: want",
      "brand: DMR V8",
      "price: about £30",
      "part of: hardtail",
      "place: pedals",
    );
    await part(
      "pedals",
      "Pedals",
      "place: pedals",
      "brand: Wellgo alloy flats",
      "condition: Pins short and domed; slippy",
      "where: On the bike",
    );
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toMatchObject({
      placed: [
        { place: "saddle", thing: "saddle", name: "Saddle" },
        { place: "pedals", thing: "pedals", name: "Pedals" },
      ],
      unplaced: [],
    });
  });

  it("draws nothing for a Thing with only one part placed, nor for a Thing whose parts have no places", async () => {
    await thing("rack", "name: Squat rack", "status: have");
    await thing("bar", "name: Pull-up bar", "status: have", "part of: rack");
    await thing("plates", "name: Plates", "status: have", "part of: rack");
    await thing("road-bike", "name: Road bike", "status: have");
    await thing("rb-saddle", "name: Saddle", "status: have", "part of: road-bike", "place: saddle");
    await thing("rb-pedals", "name: Pedals", "status: have", "part of: road-bike");
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toBeNull();
  });

  it("draws the Thing with the most parts on the drawing when two have places", async () => {
    await withBike();
    await thing("road-bike", "name: Road bike", "status: have");
    await thing("rb-saddle", "name: Saddle", "status: have", "part of: road-bike", "place: saddle");
    await thing("rb-pedals", "name: Pedals", "status: have", "part of: road-bike", "place: pedals");
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toMatchObject({ thing: "hardtail" });
  });

  it("reads past a pin left in a Thing's file by the photo view", async () => {
    await withBike();
    await part("fork", "Fork", "place: fork", "pin: 30.3, 47.1");
    const request = await asOwner(testWorker({ root }));

    const things = await request("/api/workspaces/mountain-biking/things");

    expect(await things.json()).toMatchObject({ problems: [] });
    expect((await home(request)).subject).toMatchObject({
      placed: expect.arrayContaining([{ place: "fork", thing: "fork", name: "Fork" }]),
    });
  });

  it("is only a planning workspace's", async () => {
    await mkdir(join(contextDir, "site"), { recursive: true });
    await writeFile(
      join(contextDir, "site", "workspace.json"),
      JSON.stringify({ mode: "code", repoPath: "/path/to/repo" }),
    );
    const request = await asOwner(testWorker({ root }));

    const response = await request("/api/workspaces/site/home");

    expect(response.status).toBe(409);
  });
});
