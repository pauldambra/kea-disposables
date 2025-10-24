import { resetContext, kea, actions, listeners } from "kea";
import {
  disposablesPlugin,
  __resetGlobalVisibilityStateForTests,
} from "../index";

describe("disposables", () => {
  beforeEach(() => {
    resetContext({
      plugins: [disposablesPlugin],
    });
  });

  test("disposes single disposable on unmount", () => {
    const disposed = [];

    const logic = kea([
      actions({ addDisposable: true }),
      listeners(({ cache }) => ({
        addDisposable: () => {
          cache.disposables.add(() => () => disposed.push("disposed"));
        },
      })),
    ]);

    logic.mount();
    logic.actions.addDisposable();
    expect(disposed).toEqual([]);

    logic.unmount();
    expect(disposed).toEqual(["disposed"]);
  });

  test("disposes multiple disposables on unmount", () => {
    const disposed = [];

    const logic = kea([
      actions({ addDisposables: true }),
      listeners(({ cache }) => ({
        addDisposables: () => {
          cache.disposables.add(() => () => disposed.push("first"));
          cache.disposables.add(() => () => disposed.push("second"));
          cache.disposables.add(() => () => disposed.push("third"));
        },
      })),
    ]);

    logic.mount();
    logic.actions.addDisposables();
    expect(disposed).toEqual([]);

    logic.unmount();
    expect(disposed).toEqual(["first", "second", "third"]);
  });

  test("only disposes on final unmount with multiple mounts", () => {
    const disposed = [];

    const logic = kea([
      actions({ setup: true }),
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
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

  test("setup called twice creates multiple disposables - NOT idempotent", () => {
    const disposed = [];

    const logic = kea([
      actions({ setup: true }),
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
            return () => disposed.push("disposed");
          });
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup(); // First call
    logic.actions.setup(); // Second call - creates another disposable!

    logic.unmount();
    expect(disposed).toEqual(["disposed", "disposed"]); // TWO disposals!
  });

  test("setup called twice with key - shows when disposal happens", () => {
    const events = [];

    const logic = kea([
      actions({ setup: true }),
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
            events.push("setup ran");
            return () => events.push("disposed");
          }, "setup-key"); // Using a key
        },
      })),
    ]);

    logic.mount();

    logic.actions.setup(); // First call
    expect(events).toEqual(["setup ran"]); // Setup runs immediately

    logic.actions.setup(); // Second call - should dispose first, then setup new
    expect(events).toEqual([
      "setup ran", // First setup
      "disposed", // First disposed immediately when replaced
      "setup ran", // Second setup
    ]);

    logic.unmount(); // Should dispose the second one
    expect(events).toEqual([
      "setup ran", // First setup
      "disposed", // First disposed when replaced
      "setup ran", // Second setup
      "disposed", // Second disposed on unmount
    ]);
  });

  test("disposes resources added after mount", () => {
    const disposed = [];

    const logic = kea([
      actions({ laterAction: true }),
      listeners(({ cache }) => ({
        laterAction: () => {
          cache.disposables.add(() => {
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
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => () => disposed.push("first"));
          cache.disposables.add(() => () => {
            throw new Error("test error");
          });
          cache.disposables.add(() => () => disposed.push("third"));
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    logic.unmount();

    expect(disposed).toEqual(["first", "third"]);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[KEA] Disposable cleanup failed in logic"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  test("real world timeout example", () => {
    const timeouts = [];

    const logic = kea([
      actions({ startPolling: true }),
      listeners(({ cache }) => ({
        startPolling: () => {
          cache.disposables.add(() => {
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
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
            setupRuns.push("first");
            return () => disposed.push("first");
          }, key);
          cache.disposables.add(() => {
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
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(
            () => () => disposed.push("original"),
            "polling",
          );
        },
        update: () => {
          cache.disposables.add(
            () => () => mountCleanups.push("updated"),
            "polling",
          );
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
      listeners(({ cache }) => ({
        addDisposable: () => {
          cache.disposables.add(() => {
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
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
            events.push("original setup");
            return () => events.push("original cleanup");
          }, "polling");
        },
        update: () => {
          cache.disposables.add(() => {
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
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
            return () => disposed.push("manual cleanup");
          }, "test-key");
        },
        cleanup: () => {
          const wasDisposed = cache.disposables.dispose("test-key");
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
      listeners(({ cache }) => ({
        test: () => {
          const wasDisposed = cache.disposables.dispose("non-existent");
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
      listeners(({ cache }) => ({
        setup: () => {
          cache.disposables.add(() => {
            return () => {
              throw new Error("dispose error");
            };
          }, "error-key");
        },
        cleanup: () => {
          const wasDisposed = cache.disposables.dispose("error-key");
          expect(wasDisposed).toBe(true); // Still returns true even if cleanup failed
        },
      })),
    ]);

    logic.mount();
    logic.actions.setup();
    logic.actions.cleanup();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[KEA] Disposable cleanup failed in logic"),
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  describe("visibility-based pause/resume", () => {
    let visibilityChangeCallback = null;

    beforeEach(() => {
      __resetGlobalVisibilityStateForTests();

      resetContext({
        plugins: [disposablesPlugin],
      });

      jest
        .spyOn(document, "addEventListener")
        .mockImplementation((event, callback) => {
          if (event === "visibilitychange") {
            visibilityChangeCallback = callback;
          }
        });

      Object.defineProperty(document, "hidden", {
        configurable: true,
        writable: true,
        value: false,
      });
    });

    afterEach(() => {
      visibilityChangeCallback = null;
      jest.restoreAllMocks();
    });

    const setDocumentHidden = (hidden) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        writable: true,
        value: hidden,
      });
    };

    test("disposables pause when page becomes hidden", () => {
      const events = [];

      const logic = kea([
        actions({ setup: true }),
        listeners(({ cache }) => ({
          setup: () => {
            cache.disposables.add(() => {
              events.push("setup");
              return () => events.push("cleanup");
            }, "test");
          },
        })),
      ]);

      logic.mount();
      logic.actions.setup();
      expect(events).toEqual(["setup"]);

      setDocumentHidden(true);
      visibilityChangeCallback?.();
      expect(events).toEqual(["setup", "cleanup"]);

      setDocumentHidden(false);
      visibilityChangeCallback?.();
      expect(events).toEqual(["setup", "cleanup", "setup"]);

      logic.unmount();
      expect(events).toEqual(["setup", "cleanup", "setup", "cleanup"]);
    });

    test("disposables with pauseOnPageHidden: false do NOT pause", () => {
      const events = [];

      const logic = kea([
        actions({ setup: true }),
        listeners(({ cache }) => ({
          setup: () => {
            cache.disposables.add(
              () => {
                events.push("setup");
                return () => events.push("cleanup");
              },
              "test",
              { pauseOnPageHidden: false },
            );
          },
        })),
      ]);

      logic.mount();
      logic.actions.setup();
      expect(events).toEqual(["setup"]);

      setDocumentHidden(true);
      visibilityChangeCallback?.();
      expect(events).toEqual(["setup"]);

      setDocumentHidden(false);
      visibilityChangeCallback?.();
      expect(events).toEqual(["setup"]);

      logic.unmount();
      expect(events).toEqual(["setup", "cleanup"]);
    });

    test("multiple disposables pause and resume together", () => {
      const events = [];

      const logic = kea([
        actions({ setup: true }),
        listeners(({ cache }) => ({
          setup: () => {
            cache.disposables.add(() => {
              events.push("first-setup");
              return () => events.push("first-cleanup");
            }, "first");

            cache.disposables.add(() => {
              events.push("second-setup");
              return () => events.push("second-cleanup");
            }, "second");

            cache.disposables.add(
              () => {
                events.push("nopause-setup");
                return () => events.push("nopause-cleanup");
              },
              "nopause",
              { pauseOnPageHidden: false },
            );
          },
        })),
      ]);

      logic.mount();
      logic.actions.setup();
      expect(events).toEqual(["first-setup", "second-setup", "nopause-setup"]);

      setDocumentHidden(true);
      visibilityChangeCallback?.();
      expect(events).toEqual([
        "first-setup",
        "second-setup",
        "nopause-setup",
        "first-cleanup",
        "second-cleanup",
      ]);

      setDocumentHidden(false);
      visibilityChangeCallback?.();
      expect(events).toEqual([
        "first-setup",
        "second-setup",
        "nopause-setup",
        "first-cleanup",
        "second-cleanup",
        "first-setup",
        "second-setup",
      ]);
    });

    test("disposables across multiple logics all pause/resume", () => {
      const logic1Events = [];
      const logic2Events = [];

      const logic1 = kea([
        actions({ setup: true }),
        listeners(({ cache }) => ({
          setup: () => {
            cache.disposables.add(() => {
              logic1Events.push("setup");
              return () => logic1Events.push("cleanup");
            });
          },
        })),
      ]);

      const logic2 = kea([
        actions({ setup: true }),
        listeners(({ cache }) => ({
          setup: () => {
            cache.disposables.add(() => {
              logic2Events.push("setup");
              return () => logic2Events.push("cleanup");
            });
          },
        })),
      ]);

      logic1.mount();
      logic1.actions.setup();
      logic2.mount();
      logic2.actions.setup();

      expect(logic1Events).toEqual(["setup"]);
      expect(logic2Events).toEqual(["setup"]);

      setDocumentHidden(true);
      visibilityChangeCallback?.();

      expect(logic1Events).toEqual(["setup", "cleanup"]);
      expect(logic2Events).toEqual(["setup", "cleanup"]);

      setDocumentHidden(false);
      visibilityChangeCallback?.();

      expect(logic1Events).toEqual(["setup", "cleanup", "setup"]);
      expect(logic2Events).toEqual(["setup", "cleanup", "setup"]);
    });

    test("real-world setInterval pauses and resumes", () => {
      jest.useFakeTimers();
      const pollCalls = [];

      const logic = kea([
        actions({ startPolling: true }),
        listeners(({ cache }) => ({
          startPolling: () => {
            cache.disposables.add(() => {
              const intervalId = setInterval(() => {
                pollCalls.push(Date.now());
              }, 1000);
              return () => clearInterval(intervalId);
            }, "polling");
          },
        })),
      ]);

      logic.mount();
      logic.actions.startPolling();

      jest.advanceTimersByTime(3000);
      expect(pollCalls).toHaveLength(3);

      setDocumentHidden(true);
      visibilityChangeCallback?.();

      const beforeHidden = pollCalls.length;

      jest.advanceTimersByTime(3000);
      expect(pollCalls).toHaveLength(beforeHidden);

      setDocumentHidden(false);
      visibilityChangeCallback?.();

      jest.advanceTimersByTime(3000);
      expect(pollCalls).toHaveLength(beforeHidden + 3);

      jest.useRealTimers();
    });

    test("visibility listener only attached once globally", () => {
      const addEventListener = jest.spyOn(document, "addEventListener");

      const logic1 = kea([actions({}), listeners(() => ({}))]);
      const logic2 = kea([actions({}), listeners(() => ({}))]);
      const logic3 = kea([actions({}), listeners(() => ({}))]);

      logic1.mount();
      logic2.mount();
      logic3.mount();

      const visibilityListenerCount = addEventListener.mock.calls.filter(
        ([event]) => event === "visibilitychange",
      ).length;

      expect(visibilityListenerCount).toBe(1);
    });

    test("visibility listener is removed when all logics unmount", () => {
      const removeEventListener = jest.spyOn(document, "removeEventListener");

      const logic1 = kea([actions({}), listeners(() => ({}))]);
      const logic2 = kea([actions({}), listeners(() => ({}))]);

      logic1.mount();
      logic2.mount();

      logic1.unmount();
      expect(removeEventListener).not.toHaveBeenCalled();

      logic2.unmount();
      expect(removeEventListener).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    });

    test("setup errors during resume are caught and logged", () => {
      const consoleSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const events = [];

      const logic = kea([
        actions({ setup: true }),
        listeners(({ cache }) => ({
          setup: () => {
            let setupCount = 0;
            cache.disposables.add(() => {
              setupCount++;
              events.push(`setup-${setupCount}`);
              if (setupCount === 2) {
                throw new Error("Resume failed!");
              }
              return () => events.push(`cleanup-${setupCount}`);
            }, "test");
          },
        })),
      ]);

      logic.mount();
      logic.actions.setup();
      expect(events).toEqual(["setup-1"]);

      setDocumentHidden(true);
      visibilityChangeCallback?.();
      expect(events).toEqual(["setup-1", "cleanup-1"]);

      setDocumentHidden(false);
      visibilityChangeCallback?.();
      expect(events).toEqual(["setup-1", "cleanup-1", "setup-2"]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[KEA] Disposable setup failed"),
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });
});
