import { cn } from "@/shared/ui";
import { Check, type LucideIcon } from "lucide-react";

export function OnboardingStep(props: {
  eyebrow: string;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[600px]">
      <p className="m-0 text-[11px] font-semibold text-cream-muted">{props.eyebrow}</p>
      <h1
        id="misty-onboarding-title"
        className="mb-0 mt-3 max-w-[560px] text-2xl font-semibold leading-tight tracking-tight text-cream-bright sm:text-[30px]"
      >
        {props.title}
      </h1>
      <p className="mb-7 mt-3 max-w-[570px] text-sm leading-6 text-cream-muted">{props.detail}</p>
      {props.children}
    </div>
  );
}

export function ChoiceGrid<T extends string>(props: {
  choices: Array<{ id: T; title: string; detail: string; icon: LucideIcon }>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {props.choices.map((choice) => (
        <SelectionCard
          key={choice.id}
          selected={props.value === choice.id}
          title={choice.title}
          detail={choice.detail}
          icon={choice.icon}
          onClick={() => props.onChange(choice.id)}
        />
      ))}
    </div>
  );
}

export function SelectionCard(props: {
  selected: boolean;
  title: string;
  detail: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      className={cn(
        "group relative flex min-h-[92px] w-full items-start gap-3 rounded-2xl border p-4 text-left transition",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/20",
        props.selected
          ? "border-cream/30 bg-cream/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]"
          : "border-white/10 bg-white/[0.025] hover:border-white/20 hover:bg-white/[0.045]",
        props.disabled && "cursor-not-allowed opacity-45",
      )}
      disabled={props.disabled}
      aria-pressed={props.selected}
      onClick={props.onClick}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl",
          props.selected ? "bg-cream/15 text-cream-bright" : "bg-white/5 text-cream-muted",
        )}
      >
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <strong className="block text-sm font-semibold text-cream-bright">{props.title}</strong>
        <span className="mt-1 block text-xs leading-5 text-cream-muted">{props.detail}</span>
      </span>
      {props.selected ? (
        <span className="absolute right-3 top-3 grid size-5 place-items-center rounded-full bg-cream-bright text-charcoal-bg">
          <Check size={12} strokeWidth={3} />
        </span>
      ) : null}
    </button>
  );
}
