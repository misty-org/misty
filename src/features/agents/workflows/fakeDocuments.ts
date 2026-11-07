/** misty.db's agent_chats commands in memory, for tests, with the swap's compare-and-write. */
const rows = new Map<string, string>();
const key = (args: Record<string, string>) => `${args.account}|${args.kind}|${args.id}`;

export const fakeDocuments = {
  reset: () => rows.clear(),
  read: (account: string, kind: string, id: string) =>
    JSON.parse(rows.get(`${account}|${kind}|${id}`) ?? "null"),
  invoke: async (command: string, args: Record<string, string>): Promise<unknown> => {
    switch (command) {
      case "agent_chats_list":
        return [...rows.entries()]
          .filter(([name]) => name.startsWith(`${args.account}|${args.kind}|`))
          .map(([, document]) => document);
      case "agent_chats_get":
        return rows.get(key(args)) ?? null;
      case "agent_chats_swap": {
        const current = rows.get(key(args)) ?? null;
        if (current !== (args.expected ?? null)) return false;
        rows.set(key(args), args.document!);
        return true;
      }
      case "agent_chats_delete":
        rows.delete(key(args));
        return undefined;
      default:
        throw new Error(`unexpected command ${command}`);
    }
  },
};
