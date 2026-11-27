import { Avatar, AvatarFallback, AvatarImage, type AvatarSize } from "@misty/ui";
import { AgentAvatar, personTone, usePersonalAgentsStore } from "@/features/agents";
import { personInitials } from "@/shared/lib/person_initials";

export function ChatAvatar(props: {
  id: string;
  name: string;
  src?: string;
  size?: AvatarSize;
  outline?: string;
}) {
  return (
    <Avatar size={props.size} tone={personTone(props.id)} outline={props.outline}>
      {props.src ? <AvatarImage src={props.src} alt="" /> : null}
      <AvatarFallback>{personInitials(props.name)}</AvatarFallback>
    </Avatar>
  );
}

export function ChatAgentAvatar(props: { agentId?: string; name: string; size?: AvatarSize }) {
  const agent = usePersonalAgentsStore((state) =>
    props.agentId ? state.agents.find((item) => item.id === props.agentId) : undefined,
  );
  if (agent) return <AgentAvatar agent={agent} size={props.size ?? "default"} />;
  return <ChatAvatar id={props.agentId || props.name} name={props.name} size={props.size} />;
}
