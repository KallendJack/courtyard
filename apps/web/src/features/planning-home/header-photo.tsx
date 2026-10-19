import type { ThingSummary, WorkspaceSummary } from "@courtyard/contract";
import { Link } from "@tanstack/react-router";
import { Camera, Image } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/buttons/button";
import { useFilePicker } from "@/components/forms/file-picker";
import { CardDialog } from "@/components/layout/card-dialog";
import { EmptyPhotoRing, photoRingLook } from "@/components/photo/photo-ring";
import { WorkspaceIcon } from "@/components/workspace/workspace-icon";
import { thingPhotoUrl } from "../things/api.ts";

/**
 * A planning workspace's photo, top right of its header (#481; Paper, "Tablet · Home: the bike,
 * parts pinned"): its main Thing's, opening that Thing's card. With none yet, the workspace's icon
 * in the same ring, which offers to take or pick one; the photo goes in the message box, to send
 * with what the owner says about it.
 */
export function HeaderPhoto(props: {
  workspace: WorkspaceSummary;
  /** The main Thing, whose photo it is. */
  thing: ThingSummary | undefined;
  onPhoto: (photo: File) => void;
}) {
  const { workspace, thing } = props;
  const [asking, setAsking] = useState(false);
  const picked = (photo: File) => {
    setAsking(false);
    props.onPhoto(photo);
  };
  const camera = useFilePicker({ accept: "image/*", camera: true, onPick: picked });
  const library = useFilePicker({ accept: "image/*", onPick: picked });

  if (thing !== undefined) {
    return (
      <Link
        to="/workspaces/$workspaceId/things/$slug"
        params={{ workspaceId: workspace.id, slug: thing.slug }}
        aria-label={`${thing.name}'s card`}
        className={photoRingLook}
      >
        <img src={thingPhotoUrl(workspace.id, thing)} alt="" className="size-full object-cover" />
      </Link>
    );
  }
  return (
    <>
      <EmptyPhotoRing label={`Add a photo of ${workspace.name}`} onClick={() => setAsking(true)}>
        <WorkspaceIcon icon={workspace.icon} size="home" />
      </EmptyPhotoRing>
      <CardDialog
        title="Add a photo"
        note="It goes in the message box, to send with what you say about it."
        open={asking}
        onClose={() => setAsking(false)}
      >
        <div className="flex flex-col gap-2">
          <Button variant="outline" size="lg" onClick={camera.open}>
            <Camera aria-hidden />
            Take a photo
          </Button>
          <Button variant="outline" size="lg" onClick={library.open}>
            <Image aria-hidden />
            Pick a photo
          </Button>
        </div>
        {camera.picker}
        {library.picker}
      </CardDialog>
    </>
  );
}
