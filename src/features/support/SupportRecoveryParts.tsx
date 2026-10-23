import { Button } from "@/shared/ui";
import type { RefreshCw } from "lucide-react";

export function RecoveryAction(props: {
  icon: typeof RefreshCw;
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
  emphasized?: boolean;
}) {
  const Icon = props.icon;
  return (
    <div className="grid min-h-[76px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 bg-charcoal-card p-4 max-[680px]:grid-cols-[36px_minmax(0,1fr)]">
      <span className="grid size-9 place-items-center rounded-md bg-charcoal-bg text-cream-muted">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-medium text-cream">{props.title}</strong>
        <span className="mt-0.5 block text-xs leading-5 text-cream-muted">{props.detail}</span>
      </span>
      <Button
        className="min-w-32 max-[680px]:col-span-2 max-[680px]:w-full"
        variant={props.emphasized ? "default" : "outline"}
        onClick={props.onClick}
      >
        {props.action}
      </Button>
    </div>
  );
}

export function FeedbackField(props: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-xs font-medium text-cream">
      <span>
        {props.label}
        {props.required ? (
          <span className="ml-1 text-cream-muted" aria-hidden="true">
            (required)
          </span>
        ) : null}
      </span>
      {props.children}
    </label>
  );
}

export function SupportSectionBlock(props: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 min-w-0 last:mb-0">
      <div className="mb-3 min-w-0">
        <h2 className="text-sm font-semibold leading-5 text-cream">{props.title}</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-[18px] text-cream-muted">
          {props.description}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-charcoal-border/80 bg-charcoal-card">
        {props.children}
      </div>
    </section>
  );
}
