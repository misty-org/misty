import { apiRequest } from "@/api/client";
import {
  MistyCapabilityExecutionSchema,
  MistyCapabilityTargetSchema,
  MistyCapabilityEffectsSchema,
} from "@misty/contracts";
import { z } from "zod";

const approvalId = z.string().regex(/^(?:approval_)?[0-9a-f-]{36}$/);
const runId = z.string().regex(/^(?:run_|invocation_)[0-9a-f-]{36}$/);
const summarySchema = z.object({
  id: approvalId,
  run_id: runId,
  tool_name: z.string(),
  summary: z.string(),
  expires_at: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
});
const pageSchema = z.object({
  approvals: z.array(summarySchema).max(100),
  nextCursor: approvalId.optional(),
});
const reviewSchema = z.object({
  approval: z.object({
    id: approvalId,
    run_id: runId,
    state: z.enum(["pending", "approved", "denied", "expired"]),
    expires_at: z.string().datetime({ offset: true }),
  }),
  review: z.union([
    z.object({
      kind: z.literal("browser"),
      runId,
      effectId: z.string().uuid(),
      callId: z.string().min(1).max(200),
      operation: z.enum(["browser.click", "browser.interact"]),
      input: z.unknown(),
      target: z.object({
        contextId: z.string(),
        deviceId: z.string(),
        scopeId: z.string(),
        label: z.string(),
        expiresAt: z.string().datetime({ offset: true }),
      }),
      pageUrl: z.string().url(),
      pageTitle: z.string(),
      elementLabel: z.string(),
      deadline: z.string().datetime({ offset: true }),
    }),
    z.object({
      kind: z.literal("sdk").optional(),
      execution: z.unknown().transform((value) => MistyCapabilityExecutionSchema.parse(value)),
      target: z.unknown().transform((value) => MistyCapabilityTargetSchema.parse(value)),
      effects: z.unknown().transform((value) => MistyCapabilityEffectsSchema.parse(value)),
      description: z.string(),
      prepared: z.object({ account: z.string(), content: z.unknown(), input: z.unknown(), target: z.unknown(), beforeReference: z.string() }).optional(),
    }),
  ]),
});
export type CapabilityApprovalSummary = z.infer<typeof summarySchema>;
export type CapabilityApprovalReview = z.infer<typeof reviewSchema>;

// This API belongs to trusted host controls and is deliberately absent from the
// app RPC allowlist. A downloaded app cannot turn a click into account authority.
export const capabilityApprovalsApi = {
  async list(cursor = "", signal?: AbortSignal) {
    return pageSchema.parse(
      await apiRequest<unknown>(
        `/me/capability-approvals?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { signal },
      ),
    );
  },
  async review(id: string, signal?: AbortSignal) {
    approvalId.parse(id);
    const value = reviewSchema.parse(
      await apiRequest<unknown>(`/me/capability-approvals/${encodeURIComponent(id)}`, { signal }),
    );
    const detail = value.review;
    const matches =
      detail.kind === "browser"
        ? detail.runId === value.approval.run_id
        : detail.execution.targetId === detail.target.id &&
          detail.execution.targetRevision === detail.target.revision &&
          detail.execution.runId === value.approval.run_id.replace(/^(invocation_|run_)/, "");
    if (value.approval.id !== id || !matches)
      throw new Error("The action changed. Reload its review before deciding.");
    return value;
  },
  async decide(review: CapabilityApprovalReview, approved: boolean) {
    const { id, run_id } = review.approval;
    if (run_id.startsWith("invocation_")) {
      return apiRequest(
        `/me/sdk-runs/${encodeURIComponent(run_id.slice(11))}/approvals/${encodeURIComponent(id)}`,
        { method: "POST", body: JSON.stringify({ approved }) },
      );
    }
    return apiRequest(
      `/agent-runs/${encodeURIComponent(run_id)}/approvals/${encodeURIComponent(id)}`,
      { method: "POST", body: JSON.stringify({ decision: approved ? "approve" : "deny" }) },
    );
  },
};
