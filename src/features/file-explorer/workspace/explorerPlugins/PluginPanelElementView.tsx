import type { PluginCommandEntry, PluginPanelElement } from "@/services/misty/model/misty-api";
import { Button, Input } from "@/shared/ui";
import { pluginTabHostStyles } from "../ExplorerDesktopPluginStyles";

export function PluginPanelElementView(props: {
  element: PluginPanelElement;
  value: string;
  disabled: boolean;
  onInput: (value: string) => void;
  onButton: () => void;
}) {
  if (props.element.kind === "button") {
    return (
      <Button
        className={pluginTabHostStyles.button}
        type="button"
        disabled={props.disabled}
        onClick={props.onButton}
      >
        {props.element.text || props.element.id}
      </Button>
    );
  }
  if (props.element.kind === "input" || props.element.kind === "inputText") {
    return (
      <Input
        className={pluginTabHostStyles.input}
        value={props.value}
        disabled={props.disabled}
        placeholder={props.element.text}
        onChange={(event) => props.onInput(event.target.value)}
      />
    );
  }
  if (props.element.kind === "separator") return <hr className={pluginTabHostStyles.separator} />;
  if (props.element.kind === "spacing")
    return <span className={pluginTabHostStyles.spacing} aria-hidden="true" />;
  if (props.element.kind === "image")
    return <div className={pluginTabHostStyles.image}>Texture {props.element.id}</div>;
  return <p className={pluginTabHostStyles.text}>{props.element.text}</p>;
}

export function pluginCommandOnlyOpensLauncher(command: PluginCommandEntry): boolean {
  if (command.source === "launcher" || command.actionKind === "open") return true;
  const label = command.label.trim();
  return label === "Open" || label.endsWith(": Open");
}

export function pluginCommandNeedsSelection(
  command: PluginCommandEntry,
  selectedPath: string,
): boolean {
  return command.requiresSelectedFile && !selectedPath.trim();
}

export function PluginIcon(props: {
  pluginId: string;
  pluginName?: string;
  fallback: "panel" | "commands";
  size: number;
}) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-md bg-charcoal-card text-[8px] font-bold text-cream-bright"
      style={{ width: Math.max(props.size + 4, 20), height: Math.max(props.size + 4, 20) }}
      aria-hidden="true"
    >
      {(props.pluginName || props.pluginId || props.fallback).slice(0, 2).toUpperCase()}
    </span>
  );
}
