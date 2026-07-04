import { z } from "zod";
export const MistyPreparedDocumentSchema = z.strictObject({
    documentId: z.string().min(1).max(256),
    displayName: z.string().min(1).max(1024),
    mimeType: z.string().max(256),
    sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
    sections: z.array(z.strictObject({
        kind: z.string().max(128),
        locator: z.string().max(16384),
        text: z.string().max(384 * 1024),
    })).max(4096),
    truncated: z.boolean(),
});
export const mistyDocumentContracts = {
    "documents.prepare": {
        params: z.strictObject({
            handle: z.string().min(1).max(256),
            displayName: z.string().min(1).max(1024).regex(/^[^/\\\0]+$/),
            extension: z.string().regex(/^[a-zA-Z0-9]{1,16}$/),
        }),
        result: MistyPreparedDocumentSchema,
    },
};
//# sourceMappingURL=documents.js.map