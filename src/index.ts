import { LogicBuilder, beforeUnmount } from "kea";
import type { KeaPlugin, BuiltLogic } from "kea";

export type DisposableFunction = () => void;
export type SetupFunction = () => DisposableFunction;

type DisposablesManager = {
  add: (setup: SetupFunction, key?: string) => void;
  dispose: (key: string) => boolean;
  registry: Map<string, DisposableFunction>;
  keyCounter: number;
};

// Type for logic with disposables added
type LogicWithCache = BuiltLogic & {
  cache: { disposables?: DisposablesManager | null; [key: string]: any };
  disposables: DisposablesManager;
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

    const getDisposablesManager = (): DisposablesManager => {
      if (!typedLogic.cache.disposables) {
        typedLogic.cache.disposables = {
          registry: new Map(),
          keyCounter: 0,
          add: (setup: SetupFunction, key?: string) => {
            const manager = typedLogic.cache.disposables!;
            const disposableKey = key ?? `__auto_${manager.keyCounter++}`;

            // If replacing a keyed disposable, clean up the previous one first
            if (key && manager.registry.has(disposableKey)) {
              const previousCleanup = manager.registry.get(disposableKey)!;
              safeCleanup(
                previousCleanup,
                `Previous disposable cleanup failed for key "${key}"`,
              );
            }

            // Run setup function to get cleanup function
            const cleanup = setup();
            manager.registry.set(disposableKey, cleanup);
          },
          dispose: (key: string) => {
            const manager = typedLogic.cache.disposables!;
            if (!manager.registry.has(key)) return false;

            const cleanup = manager.registry.get(key)!;
            safeCleanup(cleanup, `Manual dispose failed for key "${key}"`);
            manager.registry.delete(key);
            return true;
          },
        };
      }
      return typedLogic.cache.disposables;
    };

    // Initialize the disposables manager in the cache and expose it
    const disposablesManager = getDisposablesManager();
    typedLogic.disposables = disposablesManager;

    beforeUnmount(() => {
      // Only dispose on final unmount when logic.isMounted() becomes false
      if (!typedLogic.isMounted() && typedLogic.cache.disposables) {
        typedLogic.cache.disposables.registry.forEach((disposable) => {
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
