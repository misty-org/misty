import { Pressable } from "@/shared/ui";
import { Cloud, Globe, Server } from "lucide-react";
import type { ReactNode } from "react";

export type ServerChoiceTarget = "cloud" | "own" | "browse";

function Choice(props: {
  icon: ReactNode;
  label: string;
  description: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      disabled={props.disabled}
      onClick={props.onSelect}
      className={
        "flex w-full items-start gap-3 rounded-lg border border-charcoal-border px-4 py-3 " +
        "hover:border-charcoal-active hover:bg-charcoal-hover"
      }
    >
      <span className="mt-0.5 text-cream-muted [&_svg]:size-[18px]" aria-hidden="true">
        {props.icon}
      </span>
      <span className="grid gap-0.5">
        <span className="text-[15px] font-medium text-cream-bright">{props.label}</span>
        <span className="text-sm text-cream-muted">{props.description}</span>
      </span>
    </Pressable>
  );
}

/** The wizard's first step: Misty Cloud, a server you run, or the browser alone. */
export function ServerChoiceScreen(props: {
  busy?: boolean;
  onChoose: (target: ServerChoiceTarget) => void;
}) {
  return (
    <div className="grid gap-2.5">
      <Choice
        icon={<Cloud />}
        label="Misty Cloud"
        description="Paste the link from your welcome email."
        disabled={props.busy}
        onSelect={() => props.onChoose("cloud")}
      />
      <Choice
        icon={<Server />}
        label="My own server"
        description="Sign in to a Misty server you run."
        disabled={props.busy}
        onSelect={() => props.onChoose("own")}
      />
      <Choice
        icon={<Globe />}
        label="Just browse"
        description="Use Misty as a browser. You can add a server later in Settings."
        disabled={props.busy}
        onSelect={() => props.onChoose("browse")}
      />
    </div>
  );
}
