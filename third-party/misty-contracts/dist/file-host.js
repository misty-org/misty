import { z } from "zod";
const handle = z.string().min(1).max(256);
const empty = z.strictObject({});
export const MistyFileSourceSchema = z.strictObject({
    id: handle, name: z.string().min(1).max(1024),
    kind: z.enum(["local", "remote", "device"]), providerType: z.string().max(128),
    online: z.boolean(), writable: z.boolean(),
    totalBytes: z.number().nonnegative().optional(), freeBytes: z.number().nonnegative().optional(),
    removable: z.boolean().optional(),
});
export const MistyFileDropEventSchema = z.strictObject({ type: z.enum(["enter", "over", "drop", "leave"]), position: z.strictObject({ x: z.number(), y: z.number() }), paths: z.array(z.string().max(2048)).max(100).optional() });
const indexPath = z.string().min(1).max(4096).refine(path => !/[\\\0]/.test(path) && path.split("/").every(part => part && part !== "." && part !== ".."));
export const MistyFileIndexDocumentSchema = z.strictObject({
    path: indexPath, name: z.string().min(1).max(1024), extension: z.string().max(128),
    directory: z.boolean(), bytes: z.number().int().safe().nonnegative(),
    modifiedMs: z.number().int().safe().nonnegative(), hidden: z.boolean(),
});
export const MistyFileIndexRequestSchema = z.strictObject({
    directory: handle, operation: z.enum(["init", "query", "dump", "apply"]),
    query: z.string().max(16384).optional(), offset: z.number().int().min(0).max(1000000).optional(),
    documents: z.array(MistyFileIndexDocumentSchema).max(1000).optional(),
    deletes: z.array(indexPath).max(1000).optional(),
});
export const MistyFileIndexResultSchema = z.strictObject({
    count: z.number().int().nonnegative().optional(), docs: z.array(MistyFileIndexDocumentSchema).max(10000).optional(),
    next: z.number().int().nonnegative().optional(), done: z.boolean().optional(),
});
export const mistyFileHostContracts = {
    "files.sources.share": { capability: "connections.write", platforms: ["macos"], params: z.strictObject({ directory: handle, shared: z.boolean() }), result: z.null() },
    "files.index": { capability: "files.read", platforms: ["macos"], params: MistyFileIndexRequestSchema, result: MistyFileIndexResultSchema },
    "files.sources.restoreLocation": { capability: "files.read", params: empty, result: z.union([z.null(), z.strictObject({ virtual: z.enum(["trash", "recent", "starred"]) }), z.strictObject({ unavailable: z.literal(true) }), z.strictObject({ sourceId: handle, relative: z.array(z.string().min(1).max(1024).refine(name => name !== "." && name !== ".." && !/[\\/\0]/.test(name))).max(256) })]) },
    "files.sources.list": { capability: "files.read", params: empty, result: z.array(MistyFileSourceSchema).max(256) },
    "files.sources.open": { capability: "files.read", params: z.strictObject({ sourceId: handle, write: z.boolean().default(false) }), result: z.strictObject({ handle, name: z.string().max(1024), writable: z.boolean() }) },
    "files.sources.manage": { capability: "files.read", params: z.strictObject({ kind: z.enum(["remote", "device"]) }), result: z.union([z.null(), z.undefined()]).transform(() => undefined) },
    "files.sources.unmount": { capability: "files.write", params: z.strictObject({ sourceId: handle }), result: z.union([z.null(), z.undefined()]).transform(() => undefined) },
    "files.drop.import": { capability: "files.write", params: z.strictObject({ tokens: z.array(z.string().max(2048)).min(1).max(100), directory: handle, operation: z.enum(["copy", "move"]).default("copy") }), result: z.union([z.null(), z.undefined()]).transform(() => undefined) },
    "files.previewImage": { capability: "files.read", params: z.strictObject({ handle, maxDimension: z.number().int().min(16).max(4096).default(1024) }), result: z.instanceof(ArrayBuffer).refine(bytes => bytes.byteLength <= 16 * 1024 * 1024) },
    "files.drag.start": { capability: "files.read", params: z.strictObject({ handles: z.array(handle).min(1).max(100), mode: z.enum(["copy", "move"]).default("copy") }), result: z.strictObject({ dropped: z.boolean() }) },
};
export function isMistyFileHostMethod(method) {
    return Object.hasOwn(mistyFileHostContracts, method);
}
//# sourceMappingURL=file-host.js.map