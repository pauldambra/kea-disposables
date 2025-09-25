import { LogicBuilder, beforeUnmount } from "kea";
import type { KeaPlugin, BuiltLogic } from "kea";

export type DisposableFunction = () => void;
export type SetupFunction = () => DisposableFunction;

type DisposablesManager = {
  add: (setup: SetupFunction, key?: string) => void;
  dispose: (key: string) => boolean;
};

type DisposablesCache = {
  disposables: Map<string, DisposableFunction>;
  keyCounter: number;
};

// Type for logic with disposables added
type LogicWithCache = BuiltLogic & {
  cache: { disposables?: DisposablesCache; [key: string]: any };
  disposables?: DisposablesManager;
};

export function disposables(): LogicBuilder {
  return (logic) => {
    const typedLogic = logic as LogicWithCache;
    const safeCleanup = (cleanup: DisposableFunction, context: string) => {
      try {
        cleanup();
      } catch (error) {
        console.error(`[KEA] ${context} in logic ${logic.pathString}:`, error);
      }
    };

    const getDisposablesCache = (): DisposablesCache => {
      if (!typedLogic.cache.disposables) {
        typedLogic.cache.disposables = {
          disposables: new Map(),
          keyCounter: 0,
        };
      }
      return typedLogic.cache.disposables;
    };

    const disposablesManager: DisposablesManager = {
      add: (setup: SetupFunction, key?: string) => {
        const disposablesCache = getDisposablesCache();
        const disposableKey = key ?? `__auto_${disposablesCache.keyCounter++}`;

        // If replacing a keyed disposable, clean up the previous one first
        if (key && disposablesCache.disposables.has(disposableKey)) {
          const previousCleanup =
            disposablesCache.disposables.get(disposableKey)!;
          safeCleanup(
            previousCleanup,
            `Previous disposable cleanup failed for key "${key}"`,
          );
        }

        // Run setup function to get cleanup function
        const cleanup = setup();
        disposablesCache.disposables.set(disposableKey, cleanup);
      },
      dispose: (key: string) => {
        const disposablesCache = getDisposablesCache();
        if (!disposablesCache.disposables.has(key)) return false;

        const cleanup = disposablesCache.disposables.get(key)!;
        safeCleanup(cleanup, `Manual dispose failed for key "${key}"`);
        disposablesCache.disposables.delete(key);
        return true;
      },
    };

    typedLogic.disposables = disposablesManager;

    beforeUnmount(() => {
      // Only dispose on final unmount when logic.isMounted() becomes false
      if (!typedLogic.isMounted() && typedLogic.cache.disposables) {
        typedLogic.cache.disposables.disposables.forEach((disposable) => {
          safeCleanup(disposable, "Disposable failed");
        });
        typedLogic.cache.disposables = null;
      }
    })(logic);
  };
}

export const disposablesPlugin: KeaPlugin = {
  name: "disposables",
};
