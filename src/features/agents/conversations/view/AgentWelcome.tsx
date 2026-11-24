import type { ReactNode } from "react";
import { ChannelWelcome } from "@misty/ui";
import type { AgentProfile } from "@/shared/schemas";
import { AgentAvatar } from "../../personal/AgentAvatar";

export function AgentWelcome({
  agent,
  line,
  children,
}: {
  agent?: AgentProfile;
  line: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-4">
      <ChannelWelcome
        mark={<AgentAvatar agent={agent} large />}
        title={agent?.name || "Misty"}
        line={line}
      />
      {children}
    </div>
  );
}
