import { createSpacePeerBridge } from "./spacePeerBridge";
import type { AppRpcScope } from "./rpc/session";

type Options = Parameters<typeof createSpacePeerBridge>[1];
type Bridge = ReturnType<typeof createSpacePeerBridge>;
type Member = { scope: AppRpcScope; options: Options; folders: string[] };
type Group = { members: Set<Member>; active?: { member: Member; bridge: Bridge } };
const groups = new Map<string, Group>();

/** Views of the same installed Files app share one device endpoint. Resource
 * grants remain in their originating native instances and are revoked on close. */
export function createSharedSpacePeerBridge(scope: AppRpcScope, deployment: string, options: Options): Bridge {
  const key = JSON.stringify([deployment, scope.identity.accountId, scope.identity.spaceId,
    options.installedVersion, options.authorityGeneration]);
  let group = groups.get(key);
  if (!group) { group = { members: new Set() }; groups.set(key, group); }
  const current = group;
  const member: Member = { scope, options, folders: [...options.folders] };
  current.members.add(member);
  const folders = async () => {
    const selections: string[] = [];
    for (const participant of current.members) {
      if (participant.scope.signal.aborted || !participant.folders.length) continue;
      const instance = await participant.options.instance();
      participant.scope.assert("files.read");
      for (const handle of participant.folders) selections.push("@" + JSON.stringify({ instance, handle }));
    }
    return selections;
  };
  let disposed = false;
  const assertMember = () => {
    scope.assert("connections.read");
    if (disposed || !current.members.has(member)) throw new Error("This Files peer view is closed.");
  };
  let setup: Promise<{ member: Member; bridge: Bridge }> | undefined;
  const active = async () => {
    assertMember();
    await options.backend.authorize();
    assertMember();
    if (current.active && !current.active.member.scope.signal.aborted) return current.active;
    if (!setup) setup = (async () => {
      const selected = await folders();
      assertMember();
      // Another view may have acquired the group while directory identities resolved.
      if (current.active && !current.active.member.scope.signal.aborted) return current.active;
      const bridge = createSpacePeerBridge(scope, { ...options, folders: selected });
      return current.active = { member, bridge };
    })().finally(() => { setup = undefined; });
    return setup;
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    scope.signal.removeEventListener("abort", dispose);
    current.members.delete(member);
    if (current.active?.member === member) {
      current.active.bridge.dispose();
      current.active = undefined;
    } else if (member.folders.length && current.active) {
      const selected = current.active;
      void folders().then(folders => selected.bridge.setFolders(folders)).catch(() => undefined);
    }
    if (!current.members.size && groups.get(key) === current) groups.delete(key);
  };
  scope.signal.addEventListener("abort", dispose, { once: true });
  return {
    dispose,
    async refresh() { const selected = await active(); const rows = await selected.bridge.refresh(); scope.assert(); return rows; },
    async setFolders(next) {
      scope.assert("connections.write");
      const previous = member.folders;
      member.folders = [...next];
      try { const selected = await active(); await selected.bridge.setFolders(await folders()); scope.assert(); }
      catch (error) { member.folders = previous; throw error; }
    },
    async request<T>(deviceId: string, request: Record<string, unknown>): Promise<T> {
      const selected = await active();
      const value = await selected.bridge.request<T>(deviceId, request);
      scope.assert("files.read");
      return value;
    },
    async prepare(deviceId, request) {
      const selected = await active();
      const prepared = await selected.bridge.prepare(deviceId, request);
      try {
        scope.assert("files.read");
        if (selected.member === member) return prepared;
        const sourceInstance = await selected.member.options.instance();
        const targetInstance = await options.instance();
        scope.assert("files.read");
        const owned = await options.backend.invoke<{handle: string}>("mini_app_duplicate_file_grant", {
          sourceInstance, targetInstance, handle: prepared.handle,
        });
        try { scope.assert("files.read"); }
        catch (error) { await options.backend.invoke("mini_app_device_call", {instance: targetInstance, method: "files.release", params: {handle: owned.handle}}).catch(() => undefined); throw error; }
        return { ...prepared, handle: owned.handle };
      } finally {
        if (selected.member !== member) {
          const instance = await selected.member.options.instance().catch(() => undefined);
          if (instance) await options.backend.invoke("mini_app_device_call", {instance, method: "files.release", params: {handle: prepared.handle}}).catch(() => undefined);
        }
      }
    },
  };
}
