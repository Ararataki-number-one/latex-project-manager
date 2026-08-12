export type AppShutdownPhase = "running" | "draining" | "exiting";

export interface BeforeQuitEventLike {
  preventDefault(): void;
}

interface AppShutdownOptions {
  shutdown(): Promise<void>;
  exit(exitCode: number): void;
  onBegin?(): void;
  onError?(error: unknown): void;
}

export interface AppShutdownController {
  handleBeforeQuit(event: BeforeQuitEventLike): void;
  phase(): AppShutdownPhase;
}

/**
 * Turns Electron's synchronous `before-quit` event into a single asynchronous
 * drain. Repeated quit requests remain blocked while cleanup is running; the
 * final `app.exit` is allowed through and cannot start another cleanup pass.
 */
export function createAppShutdownController(options: AppShutdownOptions): AppShutdownController {
  let currentPhase: AppShutdownPhase = "running";

  const handleBeforeQuit = (event: BeforeQuitEventLike): void => {
    options.onBegin?.();
    if (currentPhase === "exiting") return;

    event.preventDefault();
    if (currentPhase === "draining") return;
    currentPhase = "draining";

    void (async () => {
      try {
        await options.shutdown();
      } catch (error) {
        options.onError?.(error);
      } finally {
        currentPhase = "exiting";
        options.exit(0);
      }
    })();
  };

  return {
    handleBeforeQuit,
    phase: () => currentPhase
  };
}
