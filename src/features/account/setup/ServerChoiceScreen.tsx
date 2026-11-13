import { Pressable, Spinner, Text } from "@/shared/ui";
import { Cloud, Server } from "lucide-react";
import type { ReactNode } from "react";

export type ServerChoiceTarget = "cloud" | "own";

/** One server to choose, as a full-width row. */
function ServerOption(props: {
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
      wash="card"
      className="flex w-full items-center gap-3 rounded-lg border px-4 py-3"
    >
      <Text bare tone="muted" className="[&_svg]:size-4" aria-hidden="true">
        {props.busy ? <Spinner size="sm" label={false} /> : props.icon}
      </Text>
      <Text bare tone="bright" className="text-md font-medium">
        {props.label}
      </Text>
    </Pressable>
  );
}

/** Where the account lives: Misty Cloud first, a server the person runs second. */
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
    </div>
  );
}
