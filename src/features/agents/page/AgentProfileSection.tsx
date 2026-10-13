import type { ComponentProps } from "react";
import { AgentEditor } from "../components/AgentEditor";

/** The panel's profile section: the agent editor. */
export function AgentProfileSection(editor: ComponentProps<typeof AgentEditor>) {
  return <AgentEditor {...editor} />;
}
