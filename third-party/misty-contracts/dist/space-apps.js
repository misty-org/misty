import { z } from "zod";
/** Space installation authority. Package caches and member preferences are separate. */
export const SpaceAppInstallationSchema = z.looseObject({
    space_id: z.string().min(1),
    app_id: z.string().min(1),
    state: z.enum(["installed", "recoverable"]),
    installed_version: z.string().min(1),
    permission_version: z.number().int().positive(),
    granted_scopes: z.array(z.string()),
    pin_rank: z.number().int(),
    authority_generation: z.number().int().positive(),
    release_metadata: z.record(z.string(), z.json()),
    installed_at: z.string(),
    uninstalled_at: z.string().optional(),
    updated_at: z.string(),
});
export const SpaceAppSessionSchema = z.looseObject({
    app_id: z.string().min(1),
    space_id: z.string().min(1),
    token: z.string().min(1),
    scopes: z.array(z.string()),
    expires_at: z.string(),
});
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