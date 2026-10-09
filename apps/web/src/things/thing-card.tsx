import {
  THING_DETAILS,
  type ThingDetail,
  type ThingForm as ThingFormFields,
  type ThingList,
  type ThingSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/button";
import { useFilePicker } from "@/components/file-picker";
import { FormError } from "@/components/form-error";
import { PageTitle } from "@/components/page";
import { useAction } from "@/lib/use-action";
import { describeProblem } from "../problems.tsx";
import { Answer } from "../sessions/answer.tsx";
import { preparePhoto } from "../sessions/attaching.ts";
import { changeThing, deleteThing, uploadThingPhoto } from "./api.ts";
import { ThingsScope } from "./scope.tsx";
import { ThingForm } from "./thing-form.tsx";
import { StatusChip, ThingPhoto, ThingRows } from "./thing-rows.tsx";
import { boughtInWords } from "./words.ts";

/**
 * A Thing's card (ADR 0020): its photo and the details it has, the Thing it's part of and its
 * parts, Edit, Change photo and Delete, then its history, newest first, drawn like an answer.
 */
export function ThingCard(props: ThingDetail & { workspaceId: WorkspaceId; list: ThingList }) {
  const { thing, history, workspaceId } = props;
  const all = props.list.things;
  const navigate = useNavigate();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const parent = all.find((each) => each.slug === thing.partOf);
  const parts = all.filter((each) => each.partOf === thing.slug);

  const remove = useAction(async () => {
    const deleted = await deleteThing(workspaceId, thing.slug);
    if (deleted.kind !== "loaded") return describeProblem(deleted).body;
    // Deleted at once: the workspace page says so, with Undo.
    await navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId },
      search: {
        ...(deleted.data.change === null ? {} : { deleted: deleted.data.change }),
        name: thing.name,
        kind: "thing",
      },
    });
    return undefined;
  });
  const upload = useAction(async (picked: File) => {
    const ready = await preparePhoto(picked);
    if ("problem" in ready) return ready.problem;
    const uploaded = await uploadThingPhoto(workspaceId, thing.slug, ready.file);
    if (uploaded.kind !== "loaded") return describeProblem(uploaded).body;
    await router.invalidate();
    return undefined;
  });
  const photoPicker = useFilePicker({ accept: "image/*", onPick: (file) => void upload.run(file) });

  const details = [
    ["Brand", thing.brand],
    ["Bought", thing.bought === undefined ? undefined : boughtInWords(thing.bought)],
    ["Price", thing.price],
    ["Condition", thing.condition],
    ["Size", thing.size],
    ["Where", thing.where],
  ] as const;

  return (
    <ThingsScope>
      <PageTitle
        above={
          <BackLink
            workspaceId={workspaceId}
            within={parent === undefined ? "Things" : `Things · ${parent.name}`}
          />
        }
        actions={<StatusChip status={thing.status} large />}
      >
        {thing.name}
      </PageTitle>
      <div className="mt-6 flex flex-col gap-6">
        {editing ? (
          <ThingForm
            thing={thing}
            parents={all.filter((each) => each.partOf === undefined && each.slug !== thing.slug)}
            hasParts={parts.length > 0}
            save={async (form, photo) => {
              // A new photo on its own changes no field, which the worker would refuse.
              if (!sameFields(thing, form)) {
                const changed = await changeThing(workspaceId, thing.slug, form);
                if (changed.kind !== "loaded") return describeProblem(changed).body;
              }
              if (photo !== undefined) {
                const uploaded = await uploadThingPhoto(workspaceId, thing.slug, photo);
                if (uploaded.kind !== "loaded") return describeProblem(uploaded).body;
              }
              await router.invalidate();
              return undefined;
            }}
            onDone={() => setEditing(false)}
          />
        ) : (
          <>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-7">
              {thing.photo && <ThingPhoto workspaceId={workspaceId} thing={thing} size="card" />}
              <dl className="flex grow flex-col">
                {details.map(([label, value]) =>
                  value === undefined ? null : (
                    <Detail key={label} label={label}>
                      {value}
                    </Detail>
                  ),
                )}
                {parent !== undefined && (
                  <Detail label="Part of">
                    <Link
                      to="/workspaces/$workspaceId/things/$slug"
                      params={{ workspaceId, slug: parent.slug }}
                      className="font-medium text-primary-text underline"
                    >
                      {parent.name}
                    </Link>
                  </Detail>
                )}
              </dl>
            </div>
            {parts.length > 0 && (
              <ThingRows
                workspaceId={workspaceId}
                things={parts}
                all={all}
                within={thing.slug}
                label={`Parts of ${thing.name}`}
              />
            )}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={photoPicker.open}
                  disabled={upload.busy}
                >
                  {thing.photo ? "Change photo" : "Upload photo"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void remove.run()}
                  disabled={remove.busy}
                >
                  Delete
                </Button>
              </div>
              {photoPicker.picker}
              <FormError message={upload.error ?? remove.error} />
            </div>
          </>
        )}
        {history.length > 0 && (
          <section aria-label="History" className="flex flex-col gap-2.5 border-t pt-5">
            <h2 className="font-display text-[18px]/[26px] font-semibold">History</h2>
            <ul className="flex flex-col gap-2.5">
              {history.map((entry, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a history only changes as a whole, when the Thing does
                <li key={index} className="flex gap-4">
                  <span className="w-24 shrink-0 text-sm/6 text-muted-foreground">
                    {entry.date === null ? "" : boughtInWords(entry.date)}
                  </span>
                  <div className="min-w-0 grow">
                    <Answer text={entry.text} running={false} replayed={entry.text.length} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </ThingsScope>
  );
}

/** Whether the form leaves every field as the Thing has it, a blank one being none. */
const sameFields = (thing: ThingSummary, form: ThingFormFields) =>
  (["name", "status", ...THING_DETAILS, "partOf"] as const).every(
    (field) => (form[field]?.trim() || undefined) === thing[field],
  );

/** One of a Thing's details: its name, then its value. */
function Detail(props: { label: string; children: ReactNode }) {
  return (
    <div className="flex border-b py-[7px] text-sm/[22px] last:border-b-0">
      <dt className="w-24 shrink-0 text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 wrap-anywhere">{props.children}</dd>
    </div>
  );
}
