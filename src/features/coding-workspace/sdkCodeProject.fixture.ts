import { vi } from "vitest";
import { createMistyAppSDK } from "@misty/sdk";
interface Node {
  name: string;
  kind: "file" | "directory";
  text?: string;
  children?: Map<string, Node>;
  readOnly?: boolean;
  modifiedMs?: number;
}
interface Bookmark {
  node: Node;
  write: boolean;
}
interface Share {
  node: Node;
  write: boolean;
  source: symbol;
  valid(): boolean;
}
export function createSdkCodeFileFixture(
  options: {
    root?: Node;
    shares?: Map<string, Share>;
    bookmarks?: Map<string, Bookmark>;
    trash?: Node;
  } = {},
) {
  const trash: Node = options.trash ?? { name: "Trash", kind: "directory", children: new Map() };
  const shares = options.shares ?? new Map<string, Share>();
  const source = Symbol();
  const bookmarks = options.bookmarks ?? new Map<string, Bookmark>();
  const defaultFile: Node = { name: "日本語 #?.ts", kind: "file", text: "const value = 1;\r\n" };
  const defaultNested: Node = {
    name: "src",
    kind: "directory",
    children: new Map([[defaultFile.name, defaultFile]]),
  };
  const root: Node = options.root ?? {
    name: "Project",
    kind: "directory",
    children: new Map([[defaultNested.name, defaultNested]]),
  };
  const nested = root.children!.get("src")!;
  const file = [...nested.children!.values()][0];
  const handles = new Map<string, { node: Node; write: boolean }>();
  const watchers = new Map<string, string>();
  const transfers = new Map<
    string,
    { entry: string; name: string; kind: "file" | "directory"; sourceRemoved: boolean }
  >();
  let revision = 0;
  const token = (name: string) => `u:${Buffer.from(name).toString("base64url")}`;
  let next = 0;
  const grant = (node: Node, write: boolean) => {
    const handle = `handle-${++next}`;
    handles.set(handle, { node, write });
    return {
      handle,
      name: node.name,
      kind: node.kind,
      bytes: node.kind === "file" ? new TextEncoder().encode(node.text ?? "").length : undefined,
    };
  };
  const request = vi.fn(
    async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
      if (method === "lifecycle.ready") return;
      const input = params as {
        handle: string;
        ticket: string;
        bookmarkId: string;
        watcher: string;
        directory: string;
        write: boolean;
        offset: number;
        length: number;
        limit: number;
        entry?: string;
        name: string;
        kind: "file" | "directory";
        text: string;
        sourceDirectory: string;
        destinationDirectory: string;
        operation: "copy" | "move";
        jobId: string;
      };
      if (method === "files.listSavedDirectories")
        return [...bookmarks].map(([bookmarkId, saved]) => ({
          bookmarkId,
          name: saved.node.name,
          writable: saved.write,
        }));
      if (method === "files.rememberDirectory") {
        const held = handles.get(input.directory);
        if (!held || (input.write && !held.write)) throw new Error("Invalid source grant");
        const bookmarkId = crypto.randomUUID();
        bookmarks.set(bookmarkId, { node: held.node, write: input.write });
        return { bookmarkId, name: held.node.name, writable: input.write };
      }
      if (method === "files.reopenDirectory") {
        const saved = bookmarks.get(input.bookmarkId);
        if (!saved || (input.write && !saved.write)) throw new Error("Saved folder unavailable");
        const held = grant(saved.node, input.write);
        return { handle: held.handle, name: held.name, writable: input.write };
      }
      if (method === "files.forgetDirectory") {
        bookmarks.delete(input.bookmarkId);
        return null;
      }
      if (method === "files.shareDirectory") {
        const held = handles.get(input.directory);
        if (!held || (input.write && !held.write)) throw new Error("Invalid source grant");
        const ticket = crypto.randomUUID();
        shares.set(ticket, {
          node: held.node,
          write: input.write,
          source,
          valid: () => handles.has(input.directory),
        });
        return { ticket, expiresInMs: 60000 };
      }
      if (method === "files.adoptDirectory") {
        const share = shares.get(input.ticket);
        if (!share || share.source === source || !share.valid() || (input.write && !share.write))
          throw new Error("Invalid handoff");
        shares.delete(input.ticket);
        const held = grant(share.node, input.write);
        return { handle: held.handle, name: held.name, writable: input.write };
      }
      if (method === "files.cancelDirectoryShare") {
        if (shares.get(input.ticket)?.source === source) shares.delete(input.ticket);
        return null;
      }
      if (method === "files.openTrash") {
        const { handle, name } = grant(trash, true);
        return { handle, name, writable: true };
      }
      if (method === "files.pickDirectory") {
        const { handle, name } = grant(root, input.write);
        return { handle, name };
      }
      if (method === "files.release") {
        for (const [watcher, directory] of watchers)
          if (directory === input.handle) watchers.delete(watcher);
        handles.delete(input.handle);
        return null;
      }
      if (method === "files.watchClose") {
        watchers.delete(input.watcher);
        return null;
      }
      if (method === "files.watchStatus") {
        if (!watchers.has(input.watcher)) throw new Error("Closed watch");
        return { revision, active: true, reason: null };
      }
      if (method === "files.transferClose") {
        transfers.delete(input.jobId);
        return null;
      }
      if (method === "files.transferStatus") {
        const result = transfers.get(input.jobId);
        if (!result) throw new Error("Closed transfer");
        return { status: "completed", bytes: 1, files: 1, message: "Done", result };
      }
      if (method === "files.transferStart") {
        const source = handles.get(input.sourceDirectory),
          destination = handles.get(input.destinationDirectory);
        if (!source || !destination?.write || (input.operation === "move" && !source.write))
          throw new Error("Invalid transfer grants");
        const name = Buffer.from(input.entry!.slice(2), "base64url").toString();
        const original = source.node.children!.get(name);
        if (!original) throw new Error("Missing transfer source");
        let target = name,
          number = 0;
        while (destination.node.children!.has(target)) target = `${name} (copy ${++number})`;
        destination.node.children!.set(target, { ...structuredClone(original), name: target });
        if (input.operation === "move") source.node.children!.delete(name);
        const jobId = `transfer-${++next}`;
        transfers.set(jobId, {
          entry: token(target),
          name: target,
          kind: original.kind,
          sourceRemoved: input.operation === "move",
        });
        return { jobId };
      }
      const owned = handles.get(input.directory ?? input.handle);
      if (!owned) throw new Error("Closed handle");
      if (method === "files.watchDirectory") {
        const watcher = `watch-${++next}`;
        watchers.set(watcher, input.directory);
        return { watcher };
      }
      if (method === "files.stat")
        return {
          kind: owned.node.kind,
          bytes: new TextEncoder().encode(owned.node.text ?? "").byteLength,
          modifiedMs: owned.node.modifiedMs ?? 0,
          createdMs: 0,
          readOnly: owned.node.readOnly ?? false,
          writeGranted: owned.write,
        };
      const dir = owned.node.children;
      if (method === "files.readBytes")
        return new TextEncoder()
          .encode(owned.node.text ?? "")
          .slice(input.offset, input.offset + input.length).buffer;
      if (method === "files.listDirectory")
        return {
          entries: [...dir!.values()]
            .slice(input.offset, input.offset + input.limit)
            .map((node) => ({ entry: token(node.name), name: node.name, kind: node.kind })),
          nextOffset: input.offset + input.limit < dir!.size ? input.offset + input.limit : null,
        };
      const name = input.entry
        ? Buffer.from(input.entry.slice(2), "base64url").toString()
        : input.name;
      if (method === "files.openEntry") {
        const node = dir!.get(name);
        if (!node) throw new Error("Missing entry");
        if (input.write && !owned.write) throw new Error("Read only");
        return grant(node, input.write);
      }
      if (method === "files.readText") return { text: owned.node.text ?? "" };
      if (!owned.write) throw new Error("Read only");
      if (method === "files.writeText") {
        owned.node.text = input.text;
        owned.node.modifiedMs = (owned.node.modifiedMs ?? 0) + 1;
        revision++;
        return null;
      }
      if (method === "files.createEntry") {
        if (dir!.has(name)) throw new Error("Already exists");
        dir!.set(name, {
          name,
          kind: input.kind,
          text: input.kind === "file" ? "" : undefined,
          children: input.kind === "directory" ? new Map() : undefined,
        });
        return { entry: token(name), name, kind: input.kind };
      }
      if (method === "files.renameEntry") {
        if (dir!.has(input.name)) throw new Error("Already exists");
        const node = dir!.get(name)!;
        dir!.delete(name);
        node.name = input.name;
        dir!.set(node.name, node);
        return { entry: token(node.name), name: node.name };
      }
      if (method === "files.removeEntry") {
        dir!.delete(name);
        return null;
      }
      throw new Error(`Unexpected method ${method}`);
    },
  );
  const sdk = createMistyAppSDK({ request });
  return {
    sdk,
    fork: () => createSdkCodeFileFixture({ root, shares, bookmarks, trash }),
    shares,
    bookmarks,
    request,
    handles,
    watchers,
    transfers,
    file,
    nested,
    root,
    trash,
    changed() {
      revision++;
    },
  };
}
