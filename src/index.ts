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
  logic: BuiltLogic;
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

    const disposablesManager: DisposablesManager = {
      add: (setup: SetupFunction, key?: string) => {
        const logicData = logicDisposables.get(logic.pathString);
        if (logicData) {
          const disposableKey = key ?? `__auto_${logicData.keyCounter++}`;

          // If replacing a keyed disposable, clean up the previous one first
          if (key && logicData.disposables.has(disposableKey)) {
            const previousCleanup = logicData.disposables.get(disposableKey);
            if (previousCleanup) {
              try {
                previousCleanup();
              } catch (error) {
                console.error(
                  `[KEA] Previous disposable cleanup failed for key "${key}" in logic ${logic.pathString}:`,
                  error,
                );
              }
            }
          }

          // Run setup function to get cleanup function
          const cleanup = setup();
          logicData.disposables.set(disposableKey, cleanup);
        }
      },
      dispose: (key: string) => {
        const logicData = logicDisposables.get(logic.pathString);
        if (logicData && logicData.disposables.has(key)) {
          const cleanup = logicData.disposables.get(key);
          if (cleanup) {
            try {
              cleanup();
            } catch (error) {
              console.error(
                `[KEA] Manual dispose failed for key "${key}" in logic ${logic.pathString}:`,
                error,
              );
            }
          }
          logicData.disposables.delete(key);
          return true;
        }
        return false;
      },
    };

    logic.disposables = disposablesManager;

    afterMount(() => {
      logicDisposables.set(logic.pathString, {
        logic,
        disposables: new Map(),
        keyCounter: 0,
      });
    })(logic);

    beforeUnmount(() => {
      const logicData = logicDisposables.get(logic.pathString);
      // Only dispose on final unmount when logic.isMounted() becomes false
      if (logicData && !logic.isMounted()) {
        logicData.disposables.forEach((disposable) => {
          try {
            disposable();
          } catch (error) {
            console.error(
              `[KEA] Disposable failed for logic ${logic.pathString}:`,
              error,
            );
          }
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
