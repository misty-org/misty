import { z } from "zod";
/** Account installation authority, independent of collaborative Spaces. */
export declare const AppInstallationSchema: z.ZodObject<{
    app_id: z.ZodString;
    state: z.ZodEnum<{
        installed: "installed";
        recoverable: "recoverable";
        purging: "purging";
        purged: "purged";
    }>;
    installed_version: z.ZodString;
    permission_version: z.ZodNumber;
    granted_scopes: z.ZodArray<z.ZodString>;
    pin_rank: z.ZodNumber;
    authority_generation: z.ZodNumber;
    release_metadata: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    installed_at: z.ZodString;
    uninstalled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    consent_required: z.ZodDefault<z.ZodBoolean>;
    updated_at: z.ZodString;
}, z.core.$loose>;
export type AppInstallation = z.output<typeof AppInstallationSchema>;
/** @deprecated Use AppInstallation; apps are account-owned. */
export declare const SpaceAppInstallationSchema: z.ZodObject<{
    app_id: z.ZodString;
    state: z.ZodEnum<{
        installed: "installed";
        recoverable: "recoverable";
        purging: "purging";
        purged: "purged";
    }>;
    installed_version: z.ZodString;
    permission_version: z.ZodNumber;
    granted_scopes: z.ZodArray<z.ZodString>;
    pin_rank: z.ZodNumber;
    authority_generation: z.ZodNumber;
    release_metadata: z.ZodRecord<z.ZodString, z.ZodJSONSchema>;
    installed_at: z.ZodString;
    uninstalled_at: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    consent_required: z.ZodDefault<z.ZodBoolean>;
    updated_at: z.ZodString;
}, z.core.$loose>;
export type SpaceAppInstallation = AppInstallation;
export declare const AppSessionSchema: z.ZodObject<{
    app_id: z.ZodString;
    token: z.ZodString;
    scopes: z.ZodArray<z.ZodString>;
    expires_at: z.ZodString;
}, z.core.$loose>;
export type AppSession = z.output<typeof AppSessionSchema>;
/** @deprecated Use AppSession; runtime sessions carry no Space authority. */
export declare const SpaceAppSessionSchema: z.ZodObject<{
    app_id: z.ZodString;
    token: z.ZodString;
    scopes: z.ZodArray<z.ZodString>;
    expires_at: z.ZodString;
}, z.core.$loose>;
export type SpaceAppSession = AppSession;
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
