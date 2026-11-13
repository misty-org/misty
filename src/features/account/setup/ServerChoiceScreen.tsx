import { Pressable, Spinner } from "@/shared/ui";
import { Cloud, Laptop, Server } from "lucide-react";
import type { ReactNode } from "react";

export type ServerChoiceTarget = "cloud" | "own" | "browse";

/** One server to choose, as a full-width row. */
export function ServerOption(props: {
  icon: ReactNode;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      disabled={props.disabled}
      onClick={props.onSelect}
      className={
        "flex w-full items-center gap-3 rounded-lg border border-charcoal-border px-4 py-3 " +
        "hover:border-charcoal-active hover:bg-charcoal-hover"
      }
    >
      <span className="text-cream-muted [&_svg]:size-[18px]" aria-hidden="true">
        {props.busy ? <Spinner size="sm" label={false} /> : props.icon}
      </span>
      <span className="text-md font-medium text-cream-bright">{props.label}</span>
    </Pressable>
  );
}

/** The wizard's first step: sign in on Misty Cloud, a server you run, or this computer alone. */
export function ServerChoiceScreen(props: {
  busy?: boolean;
  onChoose: (target: ServerChoiceTarget) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <ServerOption
        icon={<Cloud />}
        label="Misty Cloud"
        disabled={props.busy}
        onSelect={() => props.onChoose("cloud")}
      />
      <ServerOption
        icon={<Server />}
        label="Self-hosted"
        disabled={props.busy}
        onSelect={() => props.onChoose("own")}
      />
      <ServerOption
        icon={<Laptop />}
        label="Only this computer"
        disabled={props.busy}
        onSelect={() => props.onChoose("browse")}
      />
    </div>
  );
}
