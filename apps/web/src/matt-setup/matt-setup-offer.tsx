import type { MattSetup, MattSetupPiece, WorkspaceId } from "@courtyard/contract";
import { useEffect, useState } from "react";
import { ApprovalCard } from "@/components/approval-card";
import { InfoBox } from "@/components/notice";
import { WebLink } from "@/components/web-link";
import { describeProblem } from "../problems.tsx";
import { answerMattSetup, loadMattSetup } from "./api.ts";

/** One missing piece as a line of the offer. */
const lineOf = (piece: MattSetupPiece) => {
  switch (piece.kind) {
    case "file":
      return piece.path;
    case "section":
      return `The Agent skills section in ${piece.path}`;
    case "labels":
      return `Labels on GitHub: ${piece.names.join(", ")}`;
  }
};

/**
 * The setup check's offer on a code workspace's page (#181): what its repository is missing of
 * Matt Pocock's setup, as one approval card. Allowed, it says where the pull request is. Nothing
 * shows when there's nothing to offer. Loaded on its own, only for a code workspace.
 */
export default function MattSetupOffer(props: { workspaceId: WorkspaceId }) {
  const { workspaceId } = props;
  const [setup, setSetup] = useState<MattSetup>({ state: "none" });
  useEffect(() => {
    let current = true;
    void loadMattSetup(workspaceId).then((loaded) => {
      if (current && loaded.kind === "loaded") setSetup(loaded.data);
    });
    return () => {
      current = false;
    };
  }, [workspaceId]);

  if (setup.state === "none") return null;
  if (setup.state === "opened") {
    return (
      <InfoBox label="Matt's setup">
        {setup.pullRequest === null ? (
          <span>The labels are made. Nothing else was missing.</span>
        ) : (
          <span>
            Matt's setup is in{" "}
            <WebLink href={setup.pullRequest.url}>pull request #{setup.pullRequest.number}</WebLink>
            , for you to review and merge.
          </span>
        )}
      </InfoBox>
    );
  }
  return (
    <div className="mt-4">
      <ApprovalCard
        title="Add Matt's setup to this repo?"
        exact={setup.missing.map(lineOf).join("\n")}
        note="Matt Pocock's skills read these. They go on a branch of their own with a pull request for you to review; labels are made on GitHub. Not now and it won't ask again."
        denyLabel="Not now"
        onAnswer={async (answer) => {
          const answered = await answerMattSetup(
            workspaceId,
            answer === "allow" ? "allow" : "not-now",
          );
          if (answered.kind !== "loaded") return describeProblem(answered).body;
          setSetup(answered.data);
          return undefined;
        }}
      />
    </div>
  );
}
