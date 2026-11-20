import { ListCard, ListRow } from "@misty/ui";
import { Cloud, Server } from "lucide-react";

export type ServerChoiceTarget = "cloud" | "own";

/** Where the account lives: Misty Cloud first, a server the person runs second. */
export function ServerChoiceScreen(props: {
  busy?: boolean;
  onChoose: (target: ServerChoiceTarget) => void;
}) {
  return (
    <ListCard aria-label="Server">
      <li>
        <ListRow
          leading={Cloud}
          label="Misty Cloud"
          disabled={props.busy}
          onOpen={() => props.onChoose("cloud")}
        />
      </li>
      <li>
        <ListRow
          leading={Server}
          label="Self-hosted"
          disabled={props.busy}
          onOpen={() => props.onChoose("own")}
        />
      </li>
    </ListCard>
  );
}
