import { resetContext, kea, actions, listeners } from "kea";
import { disposablesPlugin, disposables } from "../index";

describe("disposables", () => {
  beforeEach(() => {
    resetContext({
      plugins: [disposablesPlugin],
    });
  });

  test.each([
    ["single disposable", 1],
    ["multiple disposables", 3],
    ["many disposables", 10],
  ])("disposes %s on unmount", (_, count) => {
    const disposed = [];

    const logic = kea([
      actions({ addDisposable: true }),
      disposables(),
      listeners(({ disposables }) => ({
        addDisposable: () => {
          for (let i = 0; i < count; i++) {
            disposables.add(() => {
              // Setup runs immediately
              return () => disposed.push(i); // Cleanup runs on unmount
            });
          }
        },
      })),
    ]);

    logic.mount();
    logic.actions.addDisposable();
    expect(disposed).toEqual([]);

    logic.unmount();
    expect(disposed).toEqual([...Array(count).keys()]);
  });

  test("only disposes on final unmount with multiple mounts", () => {
    const disposed = [];

    const logic = kea([
      actions({ setup: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => {
            return () => disposed.push("disposed");
          });
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    logic.mount();

    logic.unmount();
    expect(disposed).toEqual([]);

    logic.unmount();
    expect(disposed).toEqual(["disposed"]);
  });

  test("disposes resources added after mount", () => {
    const disposed = [];

    const logic = kea([
      actions({ laterAction: true }),
      disposables(),
      listeners(({ disposables }) => ({
        laterAction: () => {
          disposables.add(() => {
            return () => disposed.push("later");
          });
        },
      })),
    ]);

    logic.mount();
    expect(disposed).toEqual([]);

    logic.actions.laterAction();
    logic.unmount();
    expect(disposed).toEqual(["later"]);
  });

  test("handles disposable errors without breaking others", () => {
    const disposed = [];
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const logic = kea([
      actions({ setup: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => () => disposed.push("first"));
          disposables.add(() => () => {
            throw new Error("test error");
          });
          disposables.add(() => () => disposed.push("third"));
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    logic.unmount();

    expect(disposed).toEqual(["first", "third"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[KEA] Disposable failed"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  test("real world timeout example", () => {
    const timeouts = [];

    const logic = kea([
      actions({ startPolling: true }),
      disposables(),
      listeners(({ disposables }) => ({
        startPolling: () => {
          disposables.add(() => {
            const timeout = setTimeout(() => {}, 1000);
            timeouts.push(timeout);
            return () => clearTimeout(timeout);
          });
        },
      })),
    ]);

    logic.mount();
    logic.actions.startPolling();
    logic.actions.startPolling();

    expect(timeouts).toHaveLength(2);

    logic.unmount();
  });

  test.each([
    ["keyed disposable prevents duplicates", "myKey"],
    ["auto-generated keys allow duplicates", undefined],
  ])("%s", (_, key) => {
    const setupRuns = [];
    const disposed = [];

    const logic = kea([
      actions({ setup: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => {
            setupRuns.push("first");
            return () => disposed.push("first");
          }, key);
          disposables.add(() => {
            setupRuns.push("second");
            return () => disposed.push("second");
          }, key);
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();

    if (key) {
      // Both setups run, but first cleanup runs when second is added
      expect(setupRuns).toEqual(["first", "second"]);
      expect(disposed).toEqual(["first"]); // First was cleaned up when replaced
    } else {
      // Both setups run, no cleanup yet
      expect(setupRuns).toEqual(["first", "second"]);
      expect(disposed).toEqual([]);
    }

    logic.unmount();

    if (key) {
      expect(disposed).toEqual(["first", "second"]); // Only second cleanup runs on unmount
    } else {
      expect(disposed).toEqual(["first", "second"]); // Both cleanup on unmount
    }
  });

  test("keyed disposables can be overwritten", () => {
    const disposed = [];
    const mountCleanups = [];

    const logic = kea([
      actions({ setup: true, update: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => () => disposed.push("original"), "polling");
        },
        update: () => {
          disposables.add(() => () => mountCleanups.push("updated"), "polling");
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    // Original is active here
    logic.actions.update(); // This should clean up original and set up updated
    expect(disposed).toEqual(["original"]); // Original cleaned up immediately

    logic.unmount(); // This should clean up updated
    expect(mountCleanups).toEqual(["updated"]); // Updated cleaned up on unmount
  });

  test("setup functions run immediately", () => {
    const setupRuns = [];

    const logic = kea([
      actions({ addDisposable: true }),
      disposables(),
      listeners(({ disposables }) => ({
        addDisposable: () => {
          disposables.add(() => {
            setupRuns.push("setup ran");
            return () => setupRuns.push("cleanup ran");
          });
        },
      })),
    ]);

    logic.mount();
    expect(setupRuns).toEqual([]);

    logic.actions.addDisposable();
    expect(setupRuns).toEqual(["setup ran"]);

    logic.unmount();
    expect(setupRuns).toEqual(["setup ran", "cleanup ran"]);
  });

  test("keyed disposables clean up previous ones before adding new", () => {
    const events = [];

    const logic = kea([
      actions({ setup: true, update: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => {
            events.push("original setup");
            return () => events.push("original cleanup");
          }, "polling");
        },
        update: () => {
          disposables.add(() => {
            events.push("updated setup");
            return () => events.push("updated cleanup");
          }, "polling");
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    expect(events).toEqual(["original setup"]);

    logic.actions.update(); // Should cleanup original and setup new
    expect(events).toEqual([
      "original setup",
      "original cleanup",
      "updated setup",
    ]);

    logic.unmount(); // Should cleanup the updated one
    expect(events).toEqual([
      "original setup",
      "original cleanup",
      "updated setup",
      "updated cleanup",
    ]);
  });

  test("can manually dispose by key", () => {
    const disposed = [];

    const logic = kea([
      actions({ setup: true, cleanup: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => {
            return () => disposed.push("manual cleanup");
          }, "test-key");
        },
        cleanup: () => {
          const wasDisposed = disposables.dispose("test-key");
          expect(wasDisposed).toBe(true);
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    expect(disposed).toEqual([]);

    logic.actions.cleanup(); // Manual dispose
    expect(disposed).toEqual(["manual cleanup"]);

    logic.unmount(); // Should not call cleanup again
    expect(disposed).toEqual(["manual cleanup"]);
  });

  test("dispose returns false for non-existent keys", () => {
    const logic = kea([
      actions({ test: true }),
      disposables(),
      listeners(({ disposables }) => ({
        test: () => {
          const wasDisposed = disposables.dispose("non-existent");
          expect(wasDisposed).toBe(false);
        },
      })),
    ]);

    logic.mount();
    logic.actions.test();
  });

  test("dispose handles errors gracefully", () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const logic = kea([
      actions({ setup: true, cleanup: true }),
      disposables(),
      listeners(({ disposables }) => ({
        setup: () => {
          disposables.add(() => {
            return () => {
              throw new Error("dispose error");
            };
          }, "error-key");
        },
        cleanup: () => {
          const wasDisposed = disposables.dispose("error-key");
          expect(wasDisposed).toBe(true); // Still returns true even if cleanup failed
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    logic.actions.cleanup();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[KEA] Manual dispose failed"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
