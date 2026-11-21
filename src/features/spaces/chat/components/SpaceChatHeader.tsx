import { Hash, Lock, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { ChannelHeader, type ActionBarItem } from "@misty/ui";

/**
 * The chat's own bar under the window's tabs, as Discord's: what the chat is (a channel, a private
 * channel, a DM with one person or a group), then its controls.
 */
export function SpaceChatHeader(props: {
  /** A DM, of one person or a `group`. */
  direct: boolean;
  group: boolean;
  /** A private channel. */
  locked: boolean;
  name: string;
  actions?: ReadonlyArray<ActionBarItem>;
  end?: ReactNode;
}) {
  const icon = props.direct ? (props.group ? Users : User) : props.locked ? Lock : Hash;
  return <ChannelHeader icon={icon} name={props.name} actions={props.actions} end={props.end} />;
}
