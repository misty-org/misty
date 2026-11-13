import { Button, Surface, Text } from "@/shared/ui";
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
    <Surface
      tone="card"
      className="grid min-h-19 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 p-4 max-[680px]:grid-cols-[36px_minmax(0,1fr)]"
    >
      <Text bare tone="muted" className="grid size-9 place-items-center">
        <Icon />
      </Text>
      <span className="min-w-0">
        <Text bare as="strong" tone="default" className="block text-sm font-medium">
          {props.title}
        </Text>
        <Text bare tone="muted" className="mt-0.5 block text-xs leading-5">
          {props.detail}
        </Text>
      </span>
      <Button
        className="max-[680px]:col-span-2"
        // Armed for a second click, it fills, so the confirm reads as the step to take.
        variant={props.emphasized ? "primary" : "secondary"}
        onClick={props.onClick}
      >
        {props.action}
      </Button>
    </Surface>
  );
}

export function FeedbackField(props: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <Text bare as="label" tone="default" className="grid gap-2 text-xs font-medium">
      <span>
        {props.label}
        {props.required ? (
          <Text bare tone="muted" className="ml-1" aria-hidden="true">
            (required)
          </Text>
        ) : null}
      </span>
      {props.children}
    </Text>
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
        <Text bare as="h2" tone="default" className="text-sm font-semibold leading-5">
          {props.title}
        </Text>
        <Text bare as="p" tone="muted" className="mt-1 max-w-2xl text-ui leading-4">
          {props.description}
        </Text>
      </div>
      <Surface tone="card" edge="hairline" radius="lg" className="overflow-hidden">
        {props.children}
      </Surface>
    </section>
  );
}
