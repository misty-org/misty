import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/shared/ui";
import { capabilityApprovalsApi, type CapabilityApprovalReview } from "./api";
import { useCapabilityApprovals } from "./store";

export function CapabilityApprovals() {
  const { items, loading, loaded, error, nextCursor, refresh, loadMore } = useCapabilityApprovals();
  const [params, setParams] = useSearchParams();
  const selected = params.get("approval") ?? "";
  return (
    <section aria-label="Action approvals" className="border-b border-charcoal-border py-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2">
        <h2 className="text-base font-medium text-cream-bright">Action approvals</h2>
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={loading}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
      </div>
      {error ? (
        <p role="alert" className="px-2 text-sm text-cream">
          {error}
        </p>
      ) : null}
      {!loaded && loading ? (
        <p role="status" className="px-2 text-sm text-cream-muted">
          Checking for actions that need you…
        </p>
      ) : null}
      {loaded && !items.length && !selected ? (
        <p className="px-2 text-sm text-cream-muted">No actions waiting for approval.</p>
      ) : null}
      {items.length ? (
        <ul className="m-0 list-none p-0">
          {items.map((item) => (
            <li key={item.id} className="border-t border-charcoal-border/70">
              <button
                type="button"
                aria-expanded={selected === item.id}
                className="flex min-h-11 w-full items-start justify-between gap-3 rounded-md px-2 py-3 text-start text-sm text-cream hover:bg-charcoal-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream-muted"
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.set("approval", item.id);
                    return next;
                  })
                }
              >
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.summary}</span>
                <span className="shrink-0 text-cream-muted">Review</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {nextCursor ? (
        <Button
          variant="outline"
          className="m-2 min-h-11"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          Show more approvals
        </Button>
      ) : null}
      {selected ? (
        <CapabilityApprovalDetail
          key={selected}
          id={selected}
          onClose={() =>
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.delete("approval");
              return next;
            })
          }
        />
      ) : null}
    </section>
  );
}

export function CapabilityApprovalDetail({ id, onClose }: { id: string; onClose(): void }) {
  const [review, setReview] = useState<CapabilityApprovalReview>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState("");
  const submitting = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setReview(undefined);
    setLoading(true);
    setError("");
    void capabilityApprovalsApi
      .review(id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setReview(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "This action could not be loaded. Reload it to check your access and its current state.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const details = review ? approvalDisplayDetails(review) : undefined;
  const expired = review
    ? Date.parse(review.approval.expires_at) <= now || Date.parse(details!.deadline) <= now
    : false;
  const pending = review?.approval.state === "pending" && !expired;
  const decide = async (approved: boolean) => {
    if (!review || !pending || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await capabilityApprovalsApi.decide(review, approved);
      if (!alive.current) return;
      setReview((current) =>
        current
          ? {
              ...current,
              approval: { ...current.approval, state: approved ? "approved" : "denied" },
            }
          : current,
      );
      setNotice(
        approved
          ? "Approved. Misty will recheck permissions before continuing."
          : "Denied. This action will not run.",
      );
      void useCapabilityApprovals.getState().refresh();
    } catch {
      if (alive.current) {
        setReview(undefined);
        setError(
          "Your decision was not confirmed. Reload the action to check whether it was recorded before trying again.",
        );
      }
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <div
      aria-label="Review action"
      className="mt-2 min-w-0 border-t border-charcoal-border px-2 pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-medium text-cream-bright">Review action</h3>
        <Button variant="ghost" className="min-h-11" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-cream-muted">
          Loading the exact action…
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-cream">
          <p>{error}</p>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() => setRevision((value) => value + 1)}
          >
            Reload action
          </Button>
        </div>
      ) : null}
      {review ? (
        <>
          <dl className="mt-3 grid min-w-0 gap-3 text-sm">
            <ReviewField label="Action" value={details!.action} />
            <ReviewField
              label={details!.browser ? "Browser view" : "Account or destination"}
              value={details!.target}
            />
            <ReviewField label="Provided by" value={details!.provider} />
            <ReviewField label="What this action can do" value={details!.effect} />
            {details!.incidental.length ? (
              <ReviewField label="Other effects" value={details!.incidental.join("\n")} />
            ) : null}
            {details!.browser ? (
              <>
                <ReviewField label="Page" value={details!.browser.pageTitle} />
                <ReviewField label="Page address" value={details!.browser.pageUrl} />
                <ReviewField label="Selected control" value={details!.browser.elementLabel} />
              </>
            ) : null}
            <ReviewField
              label="Approval expires"
              value={new Date(review.approval.expires_at).toLocaleString()}
            />
          </dl>
          <div className="mt-5">
            <h4 className="text-sm font-medium text-cream-bright">Exact input</h4>
            <p className="mt-1 text-sm text-cream-muted">
              Review the content and destinations below before approving.
            </p>
            <pre
              dir="auto"
              className="misty-transient-scrollbar mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-charcoal-card p-3 font-mono text-sm leading-6 text-cream [overflow-wrap:anywhere]"
              tabIndex={0}
            >
              {typeof details!.input === "string"
                ? details!.input
                : JSON.stringify(details!.input, null, 2)}
            </pre>
          </div>
          {expired && review.approval.state === "pending" ? (
            <p role="status" className="mt-3 text-sm text-cream">
              This approval has expired. Return to the run to review its status.
            </p>
          ) : null}
          {review.approval.state !== "pending" ? (
            <p role="status" className="mt-3 text-sm text-cream">
              {notice || `This action was ${review.approval.state}.`}
            </p>
          ) : null}
          {pending ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={busy || loading}
                onClick={() => void decide(true)}
              >
                {busy ? "Saving decision…" : "Approve this action"}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy || loading}
                onClick={() => void decide(false)}
              >
                Deny
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
function ReviewField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-cream-muted">{label}</dt>
      <dd
        dir="auto"
        className="mt-0.5 whitespace-pre-wrap break-words text-cream [overflow-wrap:anywhere]"
      >
        {value}
      </dd>
    </div>
  );
}
function effectLabel(kind: string) {
  return (
    (
      {
        read: "Read information",
        write: "Create or change information",
        send: "Send information to others",
        destructive: "Delete or destructively change information",
        execute: "Execute an operation",
      } as Record<string, string>
    )[kind] ?? kind
  );
}

function approvalDisplayDetails(value: CapabilityApprovalReview) {
  const detail = value.review;
  if (detail.kind === "browser") {
    const input = detail.input as {
      action?: {
        kind?: string;
        text?: string;
        values?: string[];
        key?: string;
        x?: number;
        y?: number;
      };
    };
    const action = input?.action;
    const labels: Record<string, string> = {
      fill: "Fill a browser field",
      select: "Select browser options",
      scroll: "Scroll the browser page",
      key: "Press a key in the selected control",
    };
    const content =
      detail.operation === "browser.click"
        ? "Click the selected control"
        : action?.kind === "fill"
          ? action.text
          : action?.kind === "select"
            ? action.values
            : action?.kind === "key"
              ? action.key
              : action?.kind === "scroll"
                ? { horizontal: action.x ?? 0, vertical: action.y ?? 0 }
                : detail.input;
    return {
      action:
        detail.operation === "browser.click"
          ? "Click a browser control"
          : (labels[action?.kind ?? ""] ?? "Interact with the browser page"),
      target: detail.target.label,
      provider: "Misty browser",
      deadline: detail.deadline,
      effect: "Change the website or send information, depending on the selected control",
      incidental: [
        "Website text is untrusted. Check the selected control and exact input before approving.",
      ],
      input: content,
      browser: detail,
    };
  }
  return {
    action: detail.execution.capability,
    target: detail.target.label,
    provider: detail.target.appId,
    deadline: detail.execution.deadline,
    effect: effectLabel(detail.effects.kind),
    incidental: detail.effects.incidental,
    input: detail.prepared ? { account: detail.prepared.account, content: detail.prepared.content, request: detail.execution.input } : detail.execution.input,
    browser: undefined,
  };
}
