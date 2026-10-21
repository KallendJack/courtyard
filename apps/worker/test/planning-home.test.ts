import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanningHome } from "@courtyard/contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeProvider } from "../src/providers/index.ts";
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

/** A part of the hardtail, by its name. */
const part = (slug: string, name: string, ...more: readonly string[]) =>
  thing(slug, `name: ${name}`, "status: have", "part of: hardtail", ...more);

/** The hardtail with its parts as the owner named them, and a helmet that isn't one. */
const withBike = async () => {
  await thing("hardtail", "name: Boardman MHT 8.6", "status: have", "photo: photos/hardtail.jpg");
  await part("saddle", "Saddle");
  await part("pedals", "Pedals", "upcoming: DMR V8", "upcoming price: £60");
  await part("front-tyre", "Front tyre");
  await part("rear-tyre", "Rear tyre");
  await part("drivetrain", "Drivetrain");
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

    expect(await home(request)).toEqual({ subject: null, projects: [], review: null });
  });

  it("draws the Thing whose parts fit the mountain bike, each part on its place by name, an upcoming one with it, and lists the rest under it", async () => {
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

  it("places parts by the words in their names, one part to a place, and a second for a taken place goes under it", async () => {
    await thing("whyte", "name: Whyte T-140", "status: have");
    const whyte = (slug: string, name: string) =>
      thing(slug, `name: ${name}`, "status: have", "part of: whyte");
    await whyte("dropper", "OneUp dropper post");
    await whyte("chain", "KMC chain");
    await whyte("cassette", "Cassette");
    await whyte("brake-pads", "Front brake pads");
    await whyte("lock-on-grips", "Lock-on grips");
    await whyte("tyres", "Tyres");
    await whyte("back-wheel", "Back tyre");
    const request = await asOwner(testWorker({ root }));

    const subject = (await home(request)).subject;

    expect(subject).toMatchObject({
      kind: "drawing",
      placed: [
        { place: "seatpost", name: "OneUp dropper post" },
        { place: "grips", name: "Lock-on grips" },
        { place: "brakes", name: "Front brake pads" },
        // Cassette comes before the chain by name, so it takes the drivetrain's place.
        { place: "drivetrain", name: "Cassette" },
        { place: "front-tyre", name: "Tyres" },
        { place: "rear-tyre", name: "Back tyre" },
      ],
      unplaced: [{ name: "KMC chain" }],
    });
  });

  it("draws only fitted parts: a wanted one is neither on the bike nor under it (the owner's pedals, #603)", async () => {
    await thing("hardtail", "name: Boardman MHT 8.6", "status: have");
    await part("saddle", "Saddle");
    // As the owner's real files have them: the wanted DMR V8s beside the fitted Wellgo flats.
    await thing(
      "dmr-v8-pedals",
      "name: DMR V8 pedals",
      "status: want",
      "brand: DMR V8",
      "price: about £30",
      "part of: hardtail",
    );
    await part(
      "pedals",
      "Pedals",
      "brand: Wellgo alloy flats",
      "condition: Pins short and domed; slippy",
      "where: On the bike",
    );
    // A wanted Thing is a move, so Home writes the move review in the background (#603).
    const request = await asOwner(
      testWorker({ root, providers: [createFakeProvider({ delayMs: 0 })] }),
    );

    expect((await home(request)).subject).toMatchObject({
      placed: [
        { place: "saddle", thing: "saddle", name: "Saddle" },
        { place: "pedals", thing: "pedals", name: "Pedals" },
      ],
      unplaced: [],
    });
  });

  it("gives a place two fitted parts fit to the one named just for it, the other under the bike", async () => {
    await thing("hardtail", "name: Boardman MHT 8.6", "status: have");
    await part("saddle", "Saddle");
    await part("clipless-pedals", "Clipless pedals");
    await part("pedals", "Pedals");
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toMatchObject({
      placed: [
        { place: "saddle", name: "Saddle" },
        { place: "pedals", name: "Pedals" },
      ],
      unplaced: [{ name: "Clipless pedals" }],
    });
  });

  it("draws nothing for a Thing with only one part that fits, nor for a Thing whose parts don't", async () => {
    await thing("rack", "name: Squat rack", "status: have");
    await thing("bar", "name: Pull-up bar", "status: have", "part of: rack");
    await thing("plates", "name: Plates", "status: have", "part of: rack");
    await thing("road-bike", "name: Road bike", "status: have");
    await thing("rb-saddle", "name: Saddle", "status: have", "part of: road-bike");
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toBeNull();
  });

  it("draws the Thing with the most parts on the drawing when two fit", async () => {
    await withBike();
    await thing("road-bike", "name: Road bike", "status: have");
    await thing("rb-saddle", "name: Saddle", "status: have", "part of: road-bike");
    await thing("rb-pedals", "name: Pedals", "status: have", "part of: road-bike");
    const request = await asOwner(testWorker({ root }));

    expect((await home(request)).subject).toMatchObject({ thing: "hardtail" });
  });

  it("reads past a pin left in a Thing's file by the photo view", async () => {
    await withBike();
    await part("fork", "Fork", "pin: 30.3, 47.1");
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

describe("a space with no floor plan yet (#604)", () => {
  /** The garage workspace, its context file holding these facts. */
  const garage = async (...facts: readonly string[]) => {
    await mkdir(join(contextDir, "garage"), { recursive: true });
    await writeFile(
      join(contextDir, "garage", "CONTEXT.md"),
      `# Garage\n\nTurning it into an office.\n\n## Facts\n\n${facts.map((fact) => `- ${fact}\n`).join("")}`,
    );
  };
  const garageHome = async (request: Requester) =>
    PlanningHome.parse(await (await request("/api/workspaces/garage/home")).json());

  it("is the space to draw, named from the workspace, with its size and the facts that measure it", async () => {
    await garage(
      "The garage is 5.14 × 2.74 m inside.",
      "It's 2.45 m high.",
      "The boiler is in the back corner.",
      "Narrower by the door: 2.40 m.",
    );
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toEqual({
      kind: "space",
      name: "garage",
      size: "5.14 m × 2.74 m",
      measurements: [
        "The garage is 5.14 × 2.74 m inside.",
        "It's 2.45 m high.",
        "Narrower by the door: 2.40 m.",
      ],
    });
  });

  it("reads a room's size in centimetres or with both units said", async () => {
    await garage("Shed floor 240cm x 180cm.");
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toMatchObject({
      kind: "space",
      size: "240 cm × 180 cm",
    });
  });

  it("reads a floor's two sides saved as a sentence, with words between them (#658)", async () => {
    // The owner's own fact, as a model saved it.
    await garage(
      "The single garage measures approximately 5.137 m long × 2.735 m internally wide.",
    );
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toMatchObject({
      kind: "space",
      size: "5.137 m × 2.735 m",
    });
  });

  it("isn't a space without a floor's two sides saved, however many lengths are", async () => {
    await garage("The back wall is 2.4 m wide.", "Rides on Sundays.");
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toBeNull();
  });

  it("gives way to a drawn Thing, which leads Home first", async () => {
    await garage("The garage is 5.14 × 2.74 m inside.");
    const bike = join(contextDir, "garage", "things");
    await mkdir(bike, { recursive: true });
    await writeFile(join(bike, "hardtail.md"), "---\nname: Hardtail\nstatus: have\n---\n");
    for (const name of ["Saddle", "Pedals"]) {
      await writeFile(
        join(bike, `${name.toLowerCase()}.md`),
        `---\nname: ${name}\nstatus: have\npart of: hardtail\n---\n`,
      );
    }
    const request = await asOwner(testWorker({ root }));

    expect((await garageHome(request)).subject).toMatchObject({ kind: "drawing" });
  });
});
