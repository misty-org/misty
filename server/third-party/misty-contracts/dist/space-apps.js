import { z } from "zod";
/** Account installation authority, independent of collaborative Spaces. */
export const AppInstallationSchema = z.looseObject({
    app_id: z.string().min(1),
    state: z.enum(["installed", "recoverable", "purging", "purged"]),
    installed_version: z.string().min(1),
    permission_version: z.number().int().positive(),
    granted_scopes: z.array(z.string()),
    pin_rank: z.number().int(),
    authority_generation: z.number().int().positive(),
    release_metadata: z.record(z.string(), z.json()),
    installed_at: z.string(),
    uninstalled_at: z.string().nullable().optional(),
    consent_required: z.boolean().default(false),
    updated_at: z.string(),
});
/** @deprecated Use AppInstallation; apps are account-owned. */
export const SpaceAppInstallationSchema = AppInstallationSchema;
export const AppSessionSchema = z.looseObject({
    app_id: z.string().min(1),
    token: z.string().min(1),
    scopes: z.array(z.string()),
    expires_at: z.string(),
});
/** @deprecated Use AppSession; runtime sessions carry no Space authority. */
export const SpaceAppSessionSchema = AppSessionSchema;
export const PersonalSpaceTemplateSchema = z.looseObject({
    id: z.string(),
    name: z.string().min(1).max(80),
    description: z.string().max(1000),
    apps: z.array(z.strictObject({
        app_id: z.string().min(1),
        release_metadata: z.record(z.string(), z.json()),
    })),
    version: z.number().int().positive(),
    created_at: z.string(),
    updated_at: z.string(),
});
//# sourceMappingURL=space-apps.js.map