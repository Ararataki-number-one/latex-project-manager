import type { WorkbenchApi } from "@/shared/ipc";
import type { VsCodeStatus } from "@/shared/types";

export type VsCodeStatusView = VsCodeStatus;

export function getVsCodeApi(api: WorkbenchApi): WorkbenchApi["editor"] {
  return api.editor;
}
