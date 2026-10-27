import { Designs, type WorkspaceId } from "@courtyard/contract";
import { fromWorker } from "../../api/worker.ts";

// The Designs tab's calls (#522) live with it, so they stay off the first load.

const designsPath = (workspaceId: WorkspaceId) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/designs`;

/** The workspace's Paper file's boards as last exported, which starts the next export when due. */
export const loadDesigns = (workspaceId: WorkspaceId) =>
  fromWorker(designsPath(workspaceId), Designs);

/** Where a board's picture is: its name changes whenever the picture does, so it's cached. */
export const pictureAddress = (workspaceId: WorkspaceId, picture: string) =>
  `/api${designsPath(workspaceId)}/pictures/${encodeURIComponent(picture)}`;

/** The file in Paper, which "Open in Paper" opens. */
export const paperAddress = (fileId: string) =>
  `https://app.paper.design/file/${encodeURIComponent(fileId)}`;
