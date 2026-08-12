import { describe, expect, it, vi } from "vitest";
import { createAppShutdownController } from "../src/main/services/app-shutdown";

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("application shutdown controller", () => {
  it("drains once, blocks repeated quit requests, and exits exactly once", async () => {
    const drain = deferred();
    const shutdown = vi.fn(() => drain.promise);
    const exit = vi.fn();
    const onBegin = vi.fn();
    const controller = createAppShutdownController({ shutdown, exit, onBegin });
    const first = { preventDefault: vi.fn() };
    const second = { preventDefault: vi.fn() };

    controller.handleBeforeQuit(first);
    controller.handleBeforeQuit(second);

    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(second.preventDefault).toHaveBeenCalledOnce();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    expect(controller.phase()).toBe("draining");

    drain.resolve();
    await drain.promise;
    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(controller.phase()).toBe("exiting");

    const finalEvent = { preventDefault: vi.fn() };
    controller.handleBeforeQuit(finalEvent);
    expect(finalEvent.preventDefault).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("reports cleanup errors but still permits a final process exit", async () => {
    const failure = new Error("drain failed");
    const onError = vi.fn();
    const exit = vi.fn();
    const controller = createAppShutdownController({
      shutdown: async () => { throw failure; },
      exit,
      onError
    });

    controller.handleBeforeQuit({ preventDefault: vi.fn() });

    await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
    expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(controller.phase()).toBe("exiting");
  });
});
