import { ChannelWelcome } from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { AgentAvatar } from "../../personal/AgentAvatar";

export function AgentWelcome({
  agent,
  line,
}: {
  agent?: AgentProfile;
  line: string;
}) {
  return (
    <div className="px-4">
      <ChannelWelcome
        align="center"
        mark={<AgentAvatar agent={agent} large />}
        title={agent?.name || "Misty"}
        line={line}
      />
    </div>
  );
}
