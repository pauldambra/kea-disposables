import {
  setPluginContext,
  getPluginContext,
  LogicBuilder,
  afterMount,
  beforeUnmount,
} from "kea";
import type { BuiltLogic, KeaPlugin } from "kea";

export type DisposableFunction = () => void;
export type SetupFunction = () => DisposableFunction;

type DisposablesManager = {
  add: (setup: SetupFunction, key?: string) => void;
  dispose: (key: string) => boolean;
};

type LogicDisposables = {
  disposables: Map<string, DisposableFunction>;
  keyCounter: number;
};

type DisposablesPluginContext = {
  logicDisposables: Map<string, LogicDisposables>;
};

const getDisposablesContext = (): DisposablesPluginContext =>
  getPluginContext("disposables");
const setDisposablesContext = (context: DisposablesPluginContext) =>
  setPluginContext("disposables", context);

export function disposables(): LogicBuilder {
  return (logic) => {
    const { logicDisposables } = getDisposablesContext();

    const safeCleanup = (cleanup: DisposableFunction, context: string) => {
      try {
        cleanup();
      } catch (error) {
        console.error(`[KEA] ${context} in logic ${logic.pathString}:`, error);
      }
    };

    const disposablesManager: DisposablesManager = {
      add: (setup: SetupFunction, key?: string) => {
        const logicData = logicDisposables.get(logic.pathString);
        if (!logicData) return;

        const disposableKey = key ?? `__auto_${logicData.keyCounter++}`;

        // If replacing a keyed disposable, clean up the previous one first
        if (key && logicData.disposables.has(disposableKey)) {
          const previousCleanup = logicData.disposables.get(disposableKey)!;
          safeCleanup(
            previousCleanup,
            `Previous disposable cleanup failed for key "${key}"`,
          );
        }

        // Run setup function to get cleanup function
        const cleanup = setup();
        logicData.disposables.set(disposableKey, cleanup);
      },
      dispose: (key: string) => {
        const logicData = logicDisposables.get(logic.pathString);
        if (!logicData || !logicData.disposables.has(key)) return false;

        const cleanup = logicData.disposables.get(key)!;
        safeCleanup(cleanup, `Manual dispose failed for key "${key}"`);
        logicData.disposables.delete(key);
        return true;
      },
    };

    logic.disposables = disposablesManager;

    afterMount(() => {
      logicDisposables.set(logic.pathString, {
        disposables: new Map(),
        keyCounter: 0,
      });
    })(logic);

    beforeUnmount(() => {
      const logicData = logicDisposables.get(logic.pathString);
      // Only dispose on final unmount when logic.isMounted() becomes false
      if (logicData && !logic.isMounted()) {
        logicData.disposables.forEach((disposable) => {
          safeCleanup(disposable, "Disposable failed");
        });
        logicDisposables.delete(logic.pathString);
      }
    })(logic);
  };
}

export const disposablesPlugin: KeaPlugin = {
  name: "disposables",
  events: {
    afterPlugin(): void {
      setDisposablesContext({
        logicDisposables: new Map(),
      });
    },
  },
};
