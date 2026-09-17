import { z } from "zod";
/** Space installation authority. Package caches and member preferences are separate. */
export declare const SpaceAppInstallationSchema: z.ZodObject<{
    space_id: z.ZodString;
    app_id: z.ZodString;
    state: z.ZodEnum<{
        installed: "installed";
        recoverable: "recoverable";
    }>;
    installed_version: z.ZodString;
    permission_version: z.ZodNumber;
    granted_scopes: z.ZodArray<z.ZodString>;
    pin_rank: z.ZodNumber;
    authority_generation: z.ZodNumber;
    release_metadata: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    installed_at: z.ZodString;
    uninstalled_at: z.ZodOptional<z.ZodString>;
    updated_at: z.ZodString;
}, z.core.$loose>;
export type SpaceAppInstallation = z.output<typeof SpaceAppInstallationSchema>;
export declare const SpaceAppSessionSchema: z.ZodObject<{
    app_id: z.ZodString;
    space_id: z.ZodString;
    token: z.ZodString;
    scopes: z.ZodArray<z.ZodString>;
    expires_at: z.ZodString;
}, z.core.$loose>;
export type SpaceAppSession = z.output<typeof SpaceAppSessionSchema>;
export declare const PersonalSpaceTemplateSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodString;
    apps: z.ZodArray<z.ZodObject<{
        app_id: z.ZodString;
        release_metadata: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    }, z.core.$strict>>;
    version: z.ZodNumber;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, z.core.$loose>;
export type PersonalSpaceTemplate = z.output<typeof PersonalSpaceTemplateSchema>;
