import { useSpacesStore } from "@/features/spaces";
import { Field, OptionSelect } from "@/shared/ui";
import { useEffect, useMemo } from "react";

/** The account's personal Space: its protected default, which it owns. */
export function personalSpaceId(spaces: { id: string; is_default: boolean; role: string }[]) {
  return spaces.find((space) => space.is_default && space.role === "owner")?.id ?? "";
}

/**
 * Picks the one Space an agent lives in. Its files and outputs save there and
 * that Space's members can ask it for help. Misty's built-in agent stays in the
 * personal Space.
 */
export function AgentSpaceField({
  value,
  onChange,
  locked,
  moving,
}: {
  value: string;
  onChange(spaceId: string): void;
  locked: boolean;
  /** The saved agent lives somewhere else, so saving moves it. */
  moving: boolean;
}) {
  const spaces = useSpacesStore((state) => state.spaces);
  useEffect(() => {
    if (!useSpacesStore.getState().spaces.length) void useSpacesStore.getState().load();
  }, []);
  const personal = personalSpaceId(spaces);
  const options = useMemo(
    () =>
      [...spaces]
        .sort((a, b) => Number(b.id === personal) - Number(a.id === personal))
        .map((space) => ({
          value: space.id,
          label: space.id === personal ? `${space.name} (personal)` : space.name,
        })),
    [personal, spaces],
  );
  const selected = value || personal;
  const help = locked
    ? "Misty always lives in your personal Space."
    : moving
      ? "Saving moves this agent. Files it already saved stay where they are."
      : "Files and outputs from this agent save here, and the Space’s members can ask it for help.";
  return (
    <Field label="Space" hint={help}>
      <OptionSelect
        aria-label="Agent’s Space"
        value={selected}
        options={options}
        disabled={locked || !options.length}
        onValueChange={onChange}
      />
    </Field>
  );
}
