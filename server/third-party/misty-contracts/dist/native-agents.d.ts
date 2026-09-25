import { z } from "zod";
/** Personal agent contracts. Management and execution activation belong to the host. */
export declare const AgentExecutionModeSchema: z.ZodEnum<{
    user: "user";
    agent: "agent";
    team: "team";
}>;
export declare const AgentProfileInputSchema: z.ZodObject<{
    name: z.ZodString;
    role: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    instructions: z.ZodDefault<z.ZodString>;
    icon: z.ZodDefault<z.ZodString>;
    avatar: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    model_mode: z.ZodDefault<z.ZodEnum<{
        automatic: "automatic";
        pinned: "pinned";
    }>>;
    model_id: z.ZodDefault<z.ZodString>;
    reasoning_effort: z.ZodDefault<z.ZodString>;
    enabled: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strict>;
export declare const AgentProfileSchema: z.ZodObject<{
    name: z.ZodString;
    role: z.ZodString;
    description: z.ZodDefault<z.ZodString>;
    instructions: z.ZodDefault<z.ZodString>;
    icon: z.ZodDefault<z.ZodString>;
    avatar: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodJSONSchema>>;
    model_mode: z.ZodDefault<z.ZodEnum<{
        automatic: "automatic";
        pinned: "pinned";
    }>>;
    model_id: z.ZodDefault<z.ZodString>;
    reasoning_effort: z.ZodDefault<z.ZodString>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    id: z.ZodString;
    owner_user_id: z.ZodString;
    system_managed: z.ZodBoolean;
    version: z.ZodNumber;
    created_at: z.ZodString;
    updated_at: z.ZodString;
}, z.core.$strict>;
export declare const AgentTaskContextSchema: z.ZodObject<{
    taskId: z.ZodString;
    agentId: z.ZodString;
    spaceId: z.ZodDefault<z.ZodString>;
    executionMode: z.ZodEnum<{
        user: "user";
        agent: "agent";
        team: "team";
    }>;
    windowLabel: z.ZodString;
}, z.core.$strict>;
export declare const AgentTaskArtifactSchema: z.ZodObject<{
    id: z.ZodString;
    taskId: z.ZodString;
    name: z.ZodString;
    mimeType: z.ZodString;
    byteSize: z.ZodNumber;
    state: z.ZodEnum<{
        failed: "failed";
        pending: "pending";
        ready: "ready";
    }>;
}, z.core.$strict>;
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeSchema>;
export type AgentProfileInput = z.infer<typeof AgentProfileInputSchema>;
export type AgentProfile = z.infer<typeof AgentProfileSchema>;
export type AgentTaskContext = z.infer<typeof AgentTaskContextSchema>;
export type AgentTaskArtifact = z.infer<typeof AgentTaskArtifactSchema>;
