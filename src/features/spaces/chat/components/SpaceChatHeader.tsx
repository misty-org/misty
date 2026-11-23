import { Hash, Lock, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ChannelHeader, type ActionBarItem } from "@misty/ui";

export function SpaceChatHeader(props: {
  direct: boolean;
  group: boolean;
  locked: boolean;
  name: string;
  face?: ReactNode;
  actions?: ReadonlyArray<ActionBarItem>;
  end?: ReactNode;
}) {
  const icon = props.direct ? (props.group ? Users : User) : props.locked ? Lock : Hash;
  return (
    <ChannelHeader
      icon={icon}
      leading={props.face}
      name={props.name}
      actions={props.actions}
      end={props.end}
    />
  );
}
