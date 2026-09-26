import { z } from "zod";
export declare const MistyPreparedDocumentSchema: z.ZodObject<{
    documentId: z.ZodString;
    displayName: z.ZodString;
    mimeType: z.ZodString;
    sizeBytes: z.ZodNumber;
    sections: z.ZodArray<z.ZodObject<{
        kind: z.ZodString;
        locator: z.ZodString;
        text: z.ZodString;
    }, z.core.$strict>>;
    truncated: z.ZodBoolean;
}, z.core.$strict>;
export declare const mistyDocumentContracts: {
    readonly "documents.prepare": {
        readonly params: z.ZodObject<{
            handle: z.ZodString;
            displayName: z.ZodString;
            extension: z.ZodString;
        }, z.core.$strict>;
        readonly result: z.ZodObject<{
            documentId: z.ZodString;
            displayName: z.ZodString;
            mimeType: z.ZodString;
            sizeBytes: z.ZodNumber;
            sections: z.ZodArray<z.ZodObject<{
                kind: z.ZodString;
                locator: z.ZodString;
                text: z.ZodString;
            }, z.core.$strict>>;
            truncated: z.ZodBoolean;
        }, z.core.$strict>;
    };
};
export type MistyPreparedDocument = z.infer<typeof MistyPreparedDocumentSchema>;
export type MistyPrepareDocumentOptions = z.infer<typeof mistyDocumentContracts["documents.prepare"]["params"]>;
