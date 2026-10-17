import {
  CONTEXT_FILE_LONG_CHARACTERS,
  type ContextFile,
  hasLines,
  type OwnerContextShared,
  type SkillSummary,
  type WorkspaceId,
} from "@courtyard/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button, IconButton } from "@/components/buttons/button";
import { ButtonLink } from "@/components/buttons/button-link";
import { FormError } from "@/components/forms/form-error";
import { EmptyState, StatusPill } from "@/components/layout/notice";
import { CARD, SectionTitle } from "@/components/layout/page";
import { FactsPlansIdeas } from "@/components/workspace/context-lines";
import { SkillList } from "@/components/workspace/skill-list";
import { useAction } from "@/hooks/use-action";
import { describeProblem } from "../../components/layout/problems.tsx";
import { startSession } from "../sessions/composer/messages.ts";
import { GetToKnow } from "../sessions/notes/get-to-know.tsx";
import { GrillablePlan } from "../sessions/notes/grill-plan.tsx";

/**
 * What Courtyard knows (#300): the workspace's Facts, Plans and Ideas, each line with Fix (and each
 * plan with Grill this plan), what else its models read, and the ways to look after it (Recent
 * changes, Tidy); then its skills. Opened from the one row at the foot of Home.
 */
export function WhatCourtyardKnows(props: {
  workspaceId: WorkspaceId;
  contextFile: ContextFile | null;
  ownerContextShared: OwnerContextShared;
  skills: readonly SkillSummary[] | undefined;
  /** Read from the device's copy (#106): the lines alone, with nothing that needs the worker. */
  readOnly?: boolean;
}) {
  const { workspaceId, contextFile, ownerContextShared } = props;
  if (props.readOnly === true) {
    return (
      <section aria-label="What Courtyard knows" className={CARD}>
        <SectionTitle>What Courtyard knows</SectionTitle>
        {contextFile === null ? (
          <EmptyState>Nothing yet.</EmptyState>
        ) : (
          <div className="mt-4 space-y-6">
            <FactsPlansIdeas {...contextFile} />
          </div>
        )}
      </section>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="What Courtyard knows" className={CARD}>
        <SectionTitle>What Courtyard knows</SectionTitle>
        {(contextFile === null || !hasLines(contextFile)) && (
          <GetToKnow
            about={{ kind: "workspace", id: workspaceId }}
            label="Get to know this workspace"
          >
            You're asked a few questions about it, and what you say is saved here.
          </GetToKnow>
        )}
        {contextFile === null ? (
          <EmptyState>
            Nothing yet. What you tell Courtyard here is saved as it comes up, or add a{" "}
            <code>CONTEXT.md</code> to this workspace's folder yourself.
          </EmptyState>
        ) : (
          <>
            {contextFile.characters > CONTEXT_FILE_LONG_CHARACTERS && (
              <div className="mt-3">
                <StatusPill
                  action={
                    <ButtonLink size="sm" to="/tidy" search={{ workspace: workspaceId }}>
                      Tidy
                    </ButtonLink>
                  }
                >
                  Getting long: it goes with every message, so keep it to what matters.
                </StatusPill>
              </div>
            )}
            <div className="mt-4 space-y-6">
              <FactsPlansIdeas
                {...contextFile}
                line={(line, section) =>
                  section === "plans" ? (
                    <GrillablePlan workspaceId={workspaceId} plan={line}>
                      <FixLine workspaceId={workspaceId} line={line} />
                    </GrillablePlan>
                  ) : (
                    <div className="flex flex-wrap items-start gap-x-2.5">
                      <span className="min-w-0 flex-1 py-0.5">{line}</span>
                      <FixLine workspaceId={workspaceId} line={line} />
                    </div>
                  )
                }
              />
              {contextFile.other !== "" && (
                <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                  {contextFile.other}
                </pre>
              )}
            </div>
          </>
        )}
        {ownerContextShared !== "none" && (
          <p className="mt-6 text-sm text-muted-foreground">
            Also reads{" "}
            <Link to="/settings" className="text-foreground underline">
              {ownerContextShared === "all"
                ? "your owner context"
                : "how you like answers (from your owner context)"}
            </Link>
            .
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          <Link
            to="/changes"
            search={{ workspace: workspaceId }}
            className="text-foreground underline"
          >
            Recent changes
          </Link>
          , with Undo
          {contextFile !== null &&
            hasLines(contextFile) &&
            contextFile.characters <= CONTEXT_FILE_LONG_CHARACTERS && (
              <>
                {" · "}
                <Link
                  to="/tidy"
                  search={{ workspace: workspaceId }}
                  className="text-foreground underline"
                >
                  Tidy
                </Link>
              </>
            )}
        </p>
      </section>
      {props.skills !== undefined && <Skills skills={props.skills} />}
    </div>
  );
}

/** What a session started from Fix says first: the line, as it's written. */
const fixMessage = (line: string) => `This line is wrong: ${line}`;

/**
 * Fix, beside a line: a tap shows the session it starts, all of it, and Start starts it on the
 * model the worker picks, so the owner says what's wrong, by voice or typing, and the model saves
 * the change (AGENTS.md, Tap or talk).
 */
function FixLine(props: { workspaceId: WorkspaceId; line: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const message = fixMessage(props.line);
  const start = useAction(async () => {
    const session = await startSession({
      workspaceId: props.workspaceId,
      message: { text: message },
      files: [],
    });
    if (session.kind !== "loaded") return describeProblem(session).body;
    await navigate({
      to: "/workspaces/$workspaceId/sessions/$sessionId",
      params: { workspaceId: props.workspaceId, sessionId: session.data.id },
    });
    return undefined;
  });
  return (
    <>
      <IconButton
        label={`Fix: ${props.line}`}
        icon={<Pencil />}
        size="sm"
        look={open ? "pressed" : "filled"}
        expanded={open}
        onClick={() => setOpen((was) => !was)}
      />
      {open && (
        <FixStep>
          <p className="text-sm text-muted-foreground">Starts a session: "{message}"</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              busy={start.busy}
              busyLabel="Starting…"
              onClick={() => void start.run()}
            >
              Start
            </Button>
            <Button size="sm" variant="outline" waiting={start.busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          <FormError message={start.error} />
        </FixStep>
      )}
    </>
  );
}

/** Under the line, the whole width: what Fix starts. */
function FixStep(props: { children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of a step's words and buttons, not a form's fields
    <div role="group" aria-label="Fix this line" className="flex basis-full flex-col gap-2 py-2">
      {props.children}
    </div>
  );
}

/**
 * The workspace's skills (ADR 0016): each one models here can use, where it comes from, and why any
 * can't be used, then how to add one. Nothing here is a setting: skills are files.
 */
function Skills(props: { skills: readonly SkillSummary[] }) {
  return (
    <section aria-label="Skills" className={CARD}>
      <div className="flex flex-col gap-1">
        <SectionTitle>Skills</SectionTitle>
        <p className="text-sm/5.25 text-muted-foreground">
          What models here can use. Pick one with <span className="md:hidden">Skill</span>
          <span className="max-md:hidden">/</span> in the message box.
        </p>
      </div>
      <div className="mt-2">
        <SkillList skills={props.skills} label="Skills" />
      </div>
      <p className="mt-4 text-sm/5.25 text-muted-foreground">
        Add your own: a folder with a <code>SKILL.md</code>, in an <code>.agents/skills</code>{" "}
        folder in this workspace's folder, or at the top of your context folder for every workspace.
      </p>
    </section>
  );
}
