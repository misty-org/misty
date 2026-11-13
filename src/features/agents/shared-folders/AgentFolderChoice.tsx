import { ChoiceGroup } from "@/shared/ui";
import type { AgentProfile } from "@/shared/schemas";
import { useAgentFolders } from "./agentFolder";

/** Where a new agent works: a new, empty folder Misty makes, or one the person picks. */
export type NewAgentFolder = "new" | "choose";

/** The folder choice a new agent is made with. */
export function AgentFolderChoice(props: {
  value: NewAgentFolder;
  onChange(value: NewAgentFolder): void;
  disabled?: boolean;
}) {
  return (
    <ChoiceGroup
      label="Folder"
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      options={[
        { value: "new", label: "New folder" },
        { value: "choose", label: "Choose a folder" },
      ]}
    />
  );
}

/**
 * Gives a just-made agent its folder: a new one under Documents/Misty, or the one the person
 * picks in the system's dialog. Cancelling the dialog makes a new one, so the agent always has one.
 */
export async function giveNewAgentFolder(
  agent: Pick<AgentProfile, "id" | "name">,
  choice: NewAgentFolder,
): Promise<void> {
  const folders = useAgentFolders.getState();
  if (choice === "choose" && (await folders.choose(agent.id))) return;
  await folders.makeNew(agent.id, agent.name);
}
