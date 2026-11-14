import { vi } from "vitest";

interface Stored {
  revision: number;
  state: unknown;
}

/**
 * `misty.db`'s `settings_state` in memory, by scope, answering `settings_session_state` and
 * `settings_session_commit` with the same revision check, for tests of device settings.
 *
 * Make it in `vi.hoisted` so module resets keep it, and hand its `invoke` to
 * `@/shared/platform/nativeInvoke`:
 *
 *   const db = await vi.hoisted(async () =>
 *     (await import("@/tests/fakeDeviceSettings")).fakeDeviceSettings(),
 *   );
 *   vi.mock("@/shared/platform/nativeInvoke", () => ({ invoke: db.invoke }));
 */
export function fakeDeviceSettings() {
  const scopes = new Map<string, Stored>();
  /** Other commands, for a test that also needs them answered. */
  const other = vi.fn<(command: string, args?: Record<string, unknown>) => unknown>(() => {
    throw new Error("unexpected native command");
  });

  const invoke = vi.fn(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "settings_session_state") {
      return scopes.get(args.scope as string) ?? { revision: 0, state: null };
    }
    if (command === "settings_session_commit") {
      const { scope, revision, document } = args as {
        scope: string;
        revision: number;
        document: unknown;
      };
      const current = scopes.get(scope)?.revision ?? 0;
      if (current !== revision) throw new Error("SETTINGS_REVISION_CONFLICT");
      scopes.set(scope, { revision: current + 1, state: document });
      return undefined;
    }
    return other(command, args);
  });

  return {
    invoke,
    other,
    scopes,
    /** The value kept under `scope`, out of its `{ deviceSetting: 1, value }` wrapper. */
    read(scope: string): unknown {
      const state = scopes.get(scope)?.state as { deviceSetting?: number; value?: unknown } | null;
      return state && typeof state === "object" && state.deviceSetting === 1 ? state.value : state;
    },
    /** Stores `value` under `scope` as a device setting saves it. */
    write(scope: string, value: unknown) {
      const revision = (scopes.get(scope)?.revision ?? 0) + 1;
      scopes.set(scope, { revision, state: { deviceSetting: 1, value } });
    },
    reset() {
      scopes.clear();
      invoke.mockClear();
      other.mockReset();
      other.mockImplementation(() => {
        throw new Error("unexpected native command");
      });
    },
  };
}

/** Lets every pending load and save of a device setting finish. */
export const settleDeviceSettings = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
