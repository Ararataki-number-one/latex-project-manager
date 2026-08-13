import { randomUUID } from "node:crypto";

import type {
  OperationSnapshot,
  OperationSnapshotState
} from "../../shared/types";
import type { ProjectCatalog } from "./catalog";

type OperationCatalog = Pick<
  ProjectCatalog,
  "operationSnapshots" | "upsertOperationSnapshot" | "deleteOperationSnapshot"
>;

export type OperationStartInput = Omit<
  OperationSnapshot,
  "id" | "state" | "createdAt" | "updatedAt" | "completedAt"
> & {
  id?: string;
  state?: "queued" | "running";
};

export type OperationUpdate = Partial<
  Pick<OperationSnapshot, "title" | "message" | "progress" | "cancellable" | "retryable">
> & {
  state?: "queued" | "running";
};

export interface OperationFailureDetails {
  failureCode?: string;
  recoveryAction?: string;
  retryable?: boolean;
}

export type OperationCenterEventType =
  | "started"
  | "updated"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled"
  | "retried";

export interface OperationCenterEvent {
  type: OperationCenterEventType;
  snapshot: OperationSnapshot;
  previous?: OperationSnapshot;
}

export type OperationCenterListener = (event: OperationCenterEvent) => void;

export type OperationCenterErrorCode =
  | "CONTROL_FAILED"
  | "CONTROL_UNAVAILABLE"
  | "DISPOSED"
  | "DUPLICATE_ID"
  | "INVALID_PROGRESS"
  | "INVALID_TRANSITION"
  | "NON_MONOTONIC_PROGRESS"
  | "NOT_CANCELLABLE"
  | "NOT_FOUND"
  | "NOT_RETRYABLE"
  | "TERMINAL_OPERATION";

export class OperationCenterError extends Error {
  constructor(
    readonly code: OperationCenterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OperationCenterError";
  }
}

export interface OperationCenterOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface OperationController {
  cancel?: () => void | Promise<void>;
  retry?: () => void | Promise<void>;
}

const TERMINAL_STATES = new Set<OperationSnapshotState>([
  "succeeded",
  "failed",
  "cancelled",
  "blocked"
]);

/**
 * Owns the durable lifecycle of long-running main-process operations.
 *
 * The catalog intentionally remains the persistence boundary. The coordinator
 * does not keep phantom work alive across a process restart: operations that
 * were queued or running are converted to retryable failures during loading.
 */
export class OperationCenter {
  private readonly operations = new Map<string, OperationSnapshot>();
  private readonly listeners = new Set<OperationCenterListener>();
  private readonly controllers = new Map<string, OperationController>();
  private readonly createId: () => string;
  private readonly now: () => Date;
  private disposed = false;

  constructor(
    private readonly catalog: OperationCatalog,
    options: OperationCenterOptions = {}
  ) {
    this.createId = options.createId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
    this.loadAndRecover();
  }

  list(projectId?: string): OperationSnapshot[] {
    return [...this.operations.values()]
      .filter((snapshot) => projectId === undefined || snapshot.projectId === projectId)
      .sort((left, right) => {
        const updated = right.updatedAt.localeCompare(left.updatedAt);
        return updated !== 0 ? updated : right.createdAt.localeCompare(left.createdAt);
      })
      .map(cloneSnapshot);
  }

  start(input: OperationStartInput): OperationSnapshot {
    this.assertUsable();
    const id = input.id?.trim() || this.createId();
    if (this.operations.has(id)) {
      throw new OperationCenterError("DUPLICATE_ID", `Operation already exists: ${id}`);
    }
    const title = input.title.trim();
    if (!title) {
      throw new OperationCenterError("INVALID_TRANSITION", "Operation title cannot be empty.");
    }
    if (input.progress !== undefined) validateProgress(input.progress);

    const timestamp = this.timestamp();
    const snapshot: OperationSnapshot = {
      id,
      kind: input.kind,
      state: input.state ?? "queued",
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      cancellable: input.cancellable ?? true,
      retryable: input.retryable ?? true
    };
    if (input.projectId !== undefined) snapshot.projectId = input.projectId;
    if (input.message !== undefined) snapshot.message = input.message;
    if (input.progress !== undefined) snapshot.progress = input.progress;

    return this.persistAndEmit("started", snapshot);
  }

  update(id: string, patch: OperationUpdate): OperationSnapshot {
    this.assertUsable();
    const current = this.requireOperation(id);
    this.assertActive(current);

    if (patch.progress !== undefined) {
      validateProgress(patch.progress);
      if (current.progress !== undefined && patch.progress < current.progress) {
        throw new OperationCenterError(
          "NON_MONOTONIC_PROGRESS",
          `Operation progress cannot move backwards (${current.progress} -> ${patch.progress}).`
        );
      }
    }
    if (patch.state === "queued" && current.state === "running") {
      throw new OperationCenterError(
        "INVALID_TRANSITION",
        "A running operation cannot return to the queue; cancel or fail it before retrying."
      );
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new OperationCenterError("INVALID_TRANSITION", "Operation title cannot be empty.");
    }

    const next: OperationSnapshot = {
      ...current,
      ...patch,
      title: patch.title?.trim() ?? current.title,
      updatedAt: this.timestamp()
    };
    return this.persistAndEmit("updated", next, current);
  }

  complete(id: string, message?: string): OperationSnapshot {
    return this.finish(id, "succeeded", "completed", message, false);
  }

  fail(
    id: string,
    message: string,
    details: OperationFailureDetails = {}
  ): OperationSnapshot {
    return this.finish(
      id,
      "failed",
      "failed",
      message.trim() || "操作失败。",
      details.retryable ?? true,
      details
    );
  }

  block(
    id: string,
    message: string,
    details: OperationFailureDetails = {}
  ): OperationSnapshot {
    return this.finish(
      id,
      "blocked",
      "blocked",
      message.trim() || "操作已被安全阻止。",
      details.retryable ?? true,
      details
    );
  }

  cancel(id: string, message = "操作已取消。"): OperationSnapshot {
    this.assertUsable();
    const current = this.requireOperation(id);
    if (current.state === "cancelled") return cloneSnapshot(current);
    this.assertActive(current);
    if (!current.cancellable) {
      throw new OperationCenterError("NOT_CANCELLABLE", `Operation is not cancellable: ${id}`);
    }
    return this.finishSnapshot(current, "cancelled", "cancelled", message, current.retryable === true);
  }

  /**
   * Asks the concrete worker to stop before acknowledging cancellation in the
   * durable activity timeline. Renderer IPC must use this method rather than
   * changing the snapshot directly.
   */
  async requestCancel(id: string, message = "操作已取消。"): Promise<OperationSnapshot> {
    this.assertUsable();
    const current = this.requireOperation(id);
    if (current.state === "cancelled") return cloneSnapshot(current);
    this.assertActive(current);
    if (!current.cancellable) {
      throw new OperationCenterError("NOT_CANCELLABLE", `Operation is not cancellable: ${id}`);
    }
    const controller = this.controllers.get(id);
    if (!controller?.cancel) {
      throw new OperationCenterError(
        "CONTROL_UNAVAILABLE",
        `No cancellation handler is available for operation: ${id}`
      );
    }
    try {
      await controller.cancel();
    } catch (error) {
      throw new OperationCenterError(
        "CONTROL_FAILED",
        `The worker could not cancel operation ${id}: ${errorMessage(error)}`
      );
    }
    const latest = this.requireOperation(id);
    return latest.state === "cancelled" ? cloneSnapshot(latest) : this.cancel(id, message);
  }

  /**
   * Requeues durable work and returns the new snapshot. The concrete worker is
   * responsible for observing the queued item and starting it again.
   */
  retry(id: string, message = "已重新排队，等待执行。"): OperationSnapshot {
    this.assertUsable();
    const current = this.requireOperation(id);
    if (!TERMINAL_STATES.has(current.state)) {
      throw new OperationCenterError("INVALID_TRANSITION", `Operation is already active: ${id}`);
    }
    if (current.state === "succeeded" || !current.retryable) {
      throw new OperationCenterError("NOT_RETRYABLE", `Operation is not retryable: ${id}`);
    }

    const next: OperationSnapshot = {
      ...current,
      state: "queued",
      message,
      progress: 0,
      cancellable: true,
      retryable: true,
      updatedAt: this.timestamp()
    };
    delete next.completedAt;
    delete next.failureCode;
    delete next.recoveryAction;
    return this.persistAndEmit("retried", next, current);
  }

  /** Re-runs failed work only when its concrete worker registered a retry. */
  async requestRetry(id: string, message = "正在重新执行。"): Promise<OperationSnapshot> {
    this.assertUsable();
    const current = this.requireOperation(id);
    if (!TERMINAL_STATES.has(current.state)) {
      throw new OperationCenterError("INVALID_TRANSITION", `Operation is already active: ${id}`);
    }
    if (current.state === "succeeded" || !current.retryable) {
      throw new OperationCenterError("NOT_RETRYABLE", `Operation is not retryable: ${id}`);
    }
    const controller = this.controllers.get(id);
    if (!controller?.retry) {
      throw new OperationCenterError(
        "CONTROL_UNAVAILABLE",
        `No retry handler is available for operation: ${id}`
      );
    }

    this.retry(id, message);
    try {
      await controller.retry();
      const latest = this.requireOperation(id);
      return TERMINAL_STATES.has(latest.state)
        ? cloneSnapshot(latest)
        : this.complete(id, "重试已完成。");
    } catch (error) {
      const latest = this.requireOperation(id);
      if (!TERMINAL_STATES.has(latest.state)) {
        this.fail(id, errorMessage(error), {
          failureCode: "CONTROL_FAILED",
          recoveryAction: "检查失败原因后再次重试。",
          retryable: true
        });
      }
      throw new OperationCenterError(
        "CONTROL_FAILED",
        `The worker could not retry operation ${id}: ${errorMessage(error)}`
      );
    }
  }

  registerController(id: string, controller: OperationController): () => void {
    this.assertUsable();
    this.requireOperation(id);
    if (!controller.cancel && !controller.retry) {
      throw new OperationCenterError("CONTROL_UNAVAILABLE", "An operation controller must expose cancel or retry.");
    }
    this.controllers.set(id, controller);
    const current = this.requireOperation(id);
    const supportsRetry = Boolean(controller.retry)
      && TERMINAL_STATES.has(current.state)
      && current.state !== "succeeded";
    const supportsCancel = Boolean(controller.cancel) && !TERMINAL_STATES.has(current.state);
    if ((supportsRetry && !current.retryable) || (supportsCancel && !current.cancellable)) {
      this.persistAndEmit("updated", {
        ...current,
        retryable: supportsRetry || current.retryable,
        cancellable: supportsCancel || current.cancellable,
        updatedAt: this.timestamp()
      }, current);
    }
    return () => {
      if (this.controllers.get(id) === controller) this.controllers.delete(id);
    };
  }

  subscribe(listener: OperationCenterListener): () => void {
    this.assertUsable();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    this.controllers.clear();
  }

  private loadAndRecover(): void {
    const recoveryTimestamp = this.timestamp();
    for (const stored of this.catalog.operationSnapshots(undefined, 500)) {
      let snapshot = cloneSnapshot(stored);
      if (snapshot.state === "queued" || snapshot.state === "running") {
        const previousMessage = snapshot.message?.trim();
        const recoveryMessage = snapshot.state === "running"
          ? "应用上次退出时操作仍在执行，已安全停止；请重试。"
          : "应用上次退出时操作仍在等待，已安全停止；请重试。";
        snapshot = {
          ...snapshot,
          state: "failed",
          message: previousMessage ? `${recoveryMessage} 上次状态：${previousMessage}` : recoveryMessage,
          cancellable: false,
          retryable: false,
          updatedAt: recoveryTimestamp,
          completedAt: recoveryTimestamp
        };
        snapshot = cloneSnapshot(this.catalog.upsertOperationSnapshot(snapshot));
      }
      this.operations.set(snapshot.id, snapshot);
    }
  }

  private finish(
    id: string,
    state: Extract<OperationSnapshotState, "succeeded" | "failed" | "blocked">,
    event: Extract<OperationCenterEventType, "completed" | "failed" | "blocked">,
    message: string | undefined,
    retryable: boolean,
    details: OperationFailureDetails = {}
  ): OperationSnapshot {
    this.assertUsable();
    const current = this.requireOperation(id);
    if (current.state === state) return cloneSnapshot(current);
    this.assertActive(current);
    return this.finishSnapshot(current, state, event, message, retryable, details);
  }

  private finishSnapshot(
    current: OperationSnapshot,
    state: Extract<OperationSnapshotState, "succeeded" | "failed" | "cancelled" | "blocked">,
    event: Extract<OperationCenterEventType, "completed" | "failed" | "cancelled" | "blocked">,
    message: string | undefined,
    retryable: boolean,
    details: OperationFailureDetails = {}
  ): OperationSnapshot {
    const timestamp = this.timestamp();
    const next: OperationSnapshot = {
      ...current,
      state,
      cancellable: false,
      retryable,
      updatedAt: timestamp,
      completedAt: timestamp
    };
    if (state === "succeeded") next.progress = 1;
    if (message !== undefined) next.message = message;
    if (details.failureCode?.trim()) next.failureCode = details.failureCode.trim();
    else delete next.failureCode;
    if (details.recoveryAction?.trim()) next.recoveryAction = details.recoveryAction.trim();
    else delete next.recoveryAction;
    return this.persistAndEmit(event, next, current);
  }

  private persistAndEmit(
    type: OperationCenterEventType,
    snapshot: OperationSnapshot,
    previous?: OperationSnapshot
  ): OperationSnapshot {
    const persisted = cloneSnapshot(this.catalog.upsertOperationSnapshot(snapshot));
    this.operations.set(persisted.id, persisted);
    const event: OperationCenterEvent = {
      type,
      snapshot: cloneSnapshot(persisted)
    };
    if (previous !== undefined) event.previous = cloneSnapshot(previous);
    for (const listener of [...this.listeners]) listener(event);
    return cloneSnapshot(persisted);
  }

  private requireOperation(id: string): OperationSnapshot {
    const snapshot = this.operations.get(id);
    if (!snapshot) {
      throw new OperationCenterError("NOT_FOUND", `Operation not found: ${id}`);
    }
    return snapshot;
  }

  private assertActive(snapshot: OperationSnapshot): void {
    if (TERMINAL_STATES.has(snapshot.state)) {
      throw new OperationCenterError(
        "TERMINAL_OPERATION",
        `Terminal operation cannot be changed (${snapshot.state}): ${snapshot.id}`
      );
    }
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new OperationCenterError("DISPOSED", "Operation center has been disposed.");
    }
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}

function validateProgress(progress: number): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new OperationCenterError(
      "INVALID_PROGRESS",
      `Operation progress must be a finite value between 0 and 1: ${String(progress)}`
    );
  }
}

function cloneSnapshot(snapshot: OperationSnapshot): OperationSnapshot {
  return { ...snapshot };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown worker error";
}
