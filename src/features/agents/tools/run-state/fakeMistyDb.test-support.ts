/** agent_chats in memory, answering the same commands as chats.rs. For tests only. */
export const rows = new Map<string, string>();
/** settings_state in memory, by scope, with its revision check. */
export const settings = new Map<string, { revision: number; state: unknown }>();

const key = (args: { account: string; kind: string; id: string }) =>
  `${args.account}/${args.kind}/${args.id}`;

/** Runs before the next swap lands, as another window writing first. */
export const beforeSwap: { hook?: () => void } = {};

export async function fakeInvoke(command: string, args: Record<string, string | null>) {
  const typed = args as { account: string; kind: string; id: string };
  switch (command) {
    case "settings_session_state": {
      const scope = args.scope as string;
      return settings.get(scope) ?? { revision: 0, state: null };
    }
    case "settings_session_commit": {
      const { scope, revision, document } = args as unknown as {
        scope: string;
        revision: number;
        document: unknown;
      };
      const current = settings.get(scope)?.revision ?? 0;
      if (current !== revision) throw new Error("SETTINGS_REVISION_CONFLICT");
      settings.set(scope, { revision: current + 1, state: document });
      return {};
    }
    case "agent_chats_get":
      return rows.get(key(typed)) ?? null;
    case "agent_chats_list":
      return [...rows.entries()]
        .filter(([name]) => name.startsWith(`${typed.account}/${typed.kind}/`))
        .map(([, document]) => document);
    case "agent_chats_swap": {
      const hook = beforeSwap.hook;
      beforeSwap.hook = undefined;
      hook?.();
      if ((rows.get(key(typed)) ?? null) !== args.expected) return false;
      rows.set(key(typed), args.document as string);
      return true;
    }
    case "agent_chats_put":
      rows.set(key(typed), args.document as string);
      return undefined;
    case "agent_chats_delete":
      rows.delete(key(typed));
      return undefined;
  }
  throw new Error(`unexpected command ${command}`);
}
