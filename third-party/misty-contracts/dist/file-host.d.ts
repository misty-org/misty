import { z } from "zod";
export declare const MistyFileSourceSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    kind: z.ZodEnum<{
        local: "local";
        remote: "remote";
        device: "device";
    }>;
    providerType: z.ZodString;
    online: z.ZodBoolean;
    writable: z.ZodBoolean;
    totalBytes: z.ZodOptional<z.ZodNumber>;
    freeBytes: z.ZodOptional<z.ZodNumber>;
    removable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type MistyFileSource = z.output<typeof MistyFileSourceSchema>;
export declare const MistyFileDropEventSchema: z.ZodObject<{
    type: z.ZodEnum<{
        enter: "enter";
        over: "over";
        drop: "drop";
        leave: "leave";
    }>;
    position: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
    }, z.core.$strict>;
    paths: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export type MistyFileDropEvent = z.output<typeof MistyFileDropEventSchema>;
export declare const MistyFileIndexDocumentSchema: z.ZodObject<{
    path: z.ZodString;
    name: z.ZodString;
    extension: z.ZodString;
    directory: z.ZodBoolean;
    bytes: z.ZodNumber;
    modifiedMs: z.ZodNumber;
    hidden: z.ZodBoolean;
}, z.core.$strict>;
export declare const MistyFileIndexRequestSchema: z.ZodObject<{
    directory: z.ZodString;
    operation: z.ZodEnum<{
        query: "query";
        init: "init";
        dump: "dump";
        apply: "apply";
    }>;
    query: z.ZodOptional<z.ZodString>;
    offset: z.ZodOptional<z.ZodNumber>;
    documents: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        name: z.ZodString;
        extension: z.ZodString;
        directory: z.ZodBoolean;
        bytes: z.ZodNumber;
        modifiedMs: z.ZodNumber;
        hidden: z.ZodBoolean;
    }, z.core.$strict>>>;
    deletes: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const MistyFileIndexResultSchema: z.ZodObject<{
    count: z.ZodOptional<z.ZodNumber>;
    docs: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        name: z.ZodString;
        extension: z.ZodString;
        directory: z.ZodBoolean;
        bytes: z.ZodNumber;
        modifiedMs: z.ZodNumber;
        hidden: z.ZodBoolean;
    }, z.core.$strict>>>;
    next: z.ZodOptional<z.ZodNumber>;
    done: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type MistyFileIndexRequest = z.output<typeof MistyFileIndexRequestSchema>;
export type MistyFileIndexResult = z.output<typeof MistyFileIndexResultSchema>;
export type MistyFileIndexDocument = z.output<typeof MistyFileIndexDocumentSchema>;
export declare const mistyFileHostContracts: {
    readonly "files.sources.share": {
        readonly capability: "connections.write";
        readonly platforms: readonly ["macos"];
        readonly params: z.ZodObject<{
            directory: z.ZodString;
            shared: z.ZodBoolean;
        }, z.core.$strict>;
        readonly result: z.ZodNull;
    };
    readonly "files.index": {
        readonly capability: "files.read";
        readonly platforms: readonly ["macos"];
        readonly params: z.ZodObject<{
            directory: z.ZodString;
            operation: z.ZodEnum<{
                query: "query";
                init: "init";
                dump: "dump";
                apply: "apply";
            }>;
            query: z.ZodOptional<z.ZodString>;
            offset: z.ZodOptional<z.ZodNumber>;
            documents: z.ZodOptional<z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                name: z.ZodString;
                extension: z.ZodString;
                directory: z.ZodBoolean;
                bytes: z.ZodNumber;
                modifiedMs: z.ZodNumber;
                hidden: z.ZodBoolean;
            }, z.core.$strict>>>;
            deletes: z.ZodOptional<z.ZodArray<z.ZodString>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            count: z.ZodOptional<z.ZodNumber>;
            docs: z.ZodOptional<z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                name: z.ZodString;
                extension: z.ZodString;
                directory: z.ZodBoolean;
                bytes: z.ZodNumber;
                modifiedMs: z.ZodNumber;
                hidden: z.ZodBoolean;
            }, z.core.$strict>>>;
            next: z.ZodOptional<z.ZodNumber>;
            done: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>;
    };
    readonly "files.sources.restoreLocation": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodUnion<readonly [z.ZodNull, z.ZodObject<{
            virtual: z.ZodEnum<{
                trash: "trash";
                recent: "recent";
                starred: "starred";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            unavailable: z.ZodLiteral<true>;
        }, z.core.$strict>, z.ZodObject<{
            sourceId: z.ZodString;
            relative: z.ZodArray<z.ZodString>;
        }, z.core.$strict>]>;
    };
    readonly "files.sources.resolveLocation": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{
            path: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodUnion<readonly [z.ZodNull, z.ZodObject<{
            virtual: z.ZodEnum<{
                trash: "trash";
                recent: "recent";
                starred: "starred";
            }>;
        }, z.core.$strict>, z.ZodObject<{
            unavailable: z.ZodLiteral<true>;
        }, z.core.$strict>, z.ZodObject<{
            sourceId: z.ZodString;
            relative: z.ZodArray<z.ZodString>;
        }, z.core.$strict>]>;
    };
    readonly "files.sources.list": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{}, z.core.$strict>;
        readonly result: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodString;
            kind: z.ZodEnum<{
                local: "local";
                remote: "remote";
                device: "device";
            }>;
            providerType: z.ZodString;
            online: z.ZodBoolean;
            writable: z.ZodBoolean;
            totalBytes: z.ZodOptional<z.ZodNumber>;
            freeBytes: z.ZodOptional<z.ZodNumber>;
            removable: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strict>>;
    };
    readonly "files.sources.open": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{
            sourceId: z.ZodString;
            write: z.ZodDefault<z.ZodBoolean>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            handle: z.ZodString;
            name: z.ZodString;
            writable: z.ZodBoolean;
        }, z.core.$strict>;
    };
    readonly "files.sources.manage": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{
            kind: z.ZodEnum<{
                remote: "remote";
                device: "device";
            }>;
        }, z.core.$strict>;
        readonly result: z.ZodPipe<z.ZodUnion<readonly [z.ZodNull, z.ZodUndefined]>, z.ZodTransform<undefined, null | undefined>>;
    };
    readonly "files.sources.unmount": {
        readonly capability: "files.write";
        readonly params: z.ZodObject<{
            sourceId: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodPipe<z.ZodUnion<readonly [z.ZodNull, z.ZodUndefined]>, z.ZodTransform<undefined, null | undefined>>;
    };
    readonly "files.drop.import": {
        readonly capability: "files.write";
        readonly params: z.ZodObject<{
            tokens: z.ZodArray<z.ZodString>;
            directory: z.ZodString;
            operation: z.ZodDefault<z.ZodEnum<{
                copy: "copy";
                move: "move";
            }>>;
        }, z.core.$strict>;
        readonly result: z.ZodPipe<z.ZodUnion<readonly [z.ZodNull, z.ZodUndefined]>, z.ZodTransform<undefined, null | undefined>>;
    };
    readonly "files.previewUrl": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{
            handle: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodString;
    };
    readonly "files.previewImage": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{
            handle: z.ZodString;
            maxDimension: z.ZodDefault<z.ZodNumber>;
        }, z.core.$strict>;
        readonly result: z.ZodCustom<ArrayBuffer, ArrayBuffer>;
    };
    readonly "files.drag.start": {
        readonly capability: "files.read";
        readonly params: z.ZodObject<{
            handles: z.ZodArray<z.ZodString>;
            mode: z.ZodDefault<z.ZodEnum<{
                copy: "copy";
                move: "move";
            }>>;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            dropped: z.ZodBoolean;
        }, z.core.$strict>;
    };
};
export type MistyFileHostMethod = keyof typeof mistyFileHostContracts;
export declare function isMistyFileHostMethod(method: string): method is MistyFileHostMethod;
