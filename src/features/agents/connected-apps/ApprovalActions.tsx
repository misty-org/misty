import { Check } from "lucide-react";
import { Button, Text } from "@/shared/ui";
import type { AppRequest, AppRequestDecision } from "./api";

function formatCap(cap: NonNullable<AppRequest["paymentCap"]>) {
  const amount = (cap.max_amount_minor / 100).toFixed(2);
  return `${amount} ${cap.currency.toUpperCase()}`;
}

/**
 * The answers to an approval card. "Accept and remember" appears only when the
 * server says this action can be remembered, and names the exact scope it
 * would cover. Remembered approvals only apply in Auto; Ask always asks.
 */
export function ApprovalActions({
  request,
  busy,
  onDecide,
}: {
  request: AppRequest;
  busy: boolean;
  onDecide: (decision: AppRequestDecision) => void;
}) {
  const scope = request.rememberLabel?.trim();
  const remember = Boolean(request.rememberable && scope);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => onDecide("deny")}>
          Deny
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => onDecide("continue")}>
          <Check aria-hidden="true" /> Accept and continue
        </Button>
        {remember ? (
          <Button disabled={busy} onClick={() => onDecide("remember")}>
            Accept and remember
          </Button>
        ) : null}
      </div>
      {remember ? (
        <Text bare as="p" tone="muted" className="text-micro leading-4">
          Remember: {scope}
          {request.paymentCap ? ` (each payment up to ${formatCap(request.paymentCap)})` : ""}.
          {request.permissionMode === "ask"
            ? " This chat's mode checks with you first, so it still asks every time; remembered approvals apply in a mode that works without asking."
            : " You can revoke it in Settings › Agents › Permissions."}
        </Text>
      ) : null}
    </div>
  );
}
