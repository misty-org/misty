// Interaction adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { Gauge } from "lucide-react";
import * as React from "react";
import type { ButtonIcon } from "../controls/Button";
import { SkeletonList } from "../feedback/Skeleton";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../overlays/Command";
import { DropdownMenu, DropdownMenuContent } from "../overlays/DropdownMenu";
import { MenuLabel, MenuRadioGroup, MenuRadioItem } from "../overlays/MenuItem";
import { MenuTrigger } from "../overlays/MenuTrigger";
import { Popover, PopoverContent } from "../overlays/Popover";
import { Text } from "../display/Text";

/** One model the picker lists. */
export interface ModelPickerModel {
  /** What `onPick` gets. */
  value: string;
  /** Its own name, such as "Sonnet 5.5". */
  label: string;
  /** What else it goes by, such as its id. Not shown; the search matches it. */
  detail?: string;
  /** The reasoning-effort levels it takes, weakest first; empty when it takes none. */
  efforts: readonly string[];
  /** More words the search matches. */
  keywords?: readonly string[];
  /** "more" puts it under "More models", as the engine's own menu does. */
  section?: "main" | "more";
}

export interface ModelPickerProps {
  /** What is picked, such as "Model": the trigger's name and the list's name. */
  label: string;
  /** The 16px mark before the name, such as the engine's. */
  icon?: ButtonIcon;
  /** Undefined while the models are read: the list shows skeleton rows. */
  models: readonly ModelPickerModel[] | undefined;
  /** The current model's value; no row is checked when it matches none. */
  value: string;
  /** What the trigger says: the current model's name. */
  shown: string;
  /** The current effort, or "" when the current model takes none. */
  effort: string;
  /** The current model's levels; the effort button hides when there are none. */
  efforts: readonly string[];
  /** The level a row would run at if picked now. */
  effortFor(value: string): string;
  /** A level's name: the engine's own when it gives one. */
  effortLabel(level: string): string;
  /** What the engine notes on a level in its menu, such as "Recommended". */
  effortNote?(level: string): string | undefined;
  /** A row picked, with the level shown on it (changed by the arrow keys, or its own). */
  onPick(value: string, effort: string): void;
  onEffort(level: string): void;
  /** More rows at the end of the effort menu, such as a speed switch. */
  effortRows?: React.ReactNode;
  /** `icon` when the bar is short of room: the mark and a gauge, without words. */
  mode?: "full" | "icon";
  disabled?: boolean;
  /** For the composer's tour. */
  tour?: string;
}

/**
 * The model and how hard it thinks, as two buttons side by side (after OpenChamber's): the model
 * opens a search over the models, one name per row and a check on the current one; a model picked
 * runs at the level last used with it. The level is its own button and menu, shown only for a model
 * that takes levels.
 *
 * ```tsx
 * <ModelPicker label="Model" icon={mark} models={models} value={id} shown="Sonnet 5.5"
 *   effort="medium" efforts={levels} effortFor={rowEffort} effortLabel={nameOf}
 *   onPick={(model, effort) => choose({ model, effort })} onEffort={(effort) => choose({ effort })} />
 * ```
 */
export function ModelPicker(props: ModelPickerProps) {
  const icon = props.mode === "icon";
  return (
    <div className="flex min-w-0 max-w-full items-center gap-1">
      <ModelList {...props} />
      {props.efforts.length ? (
        <DropdownMenu>
          {icon ? (
            <MenuTrigger
              label={`Reasoning effort: ${props.effortLabel(props.effort)}`}
              iconOnly
              icon={Gauge}
              disabled={props.disabled}
              data-tour={props.tour ? `${props.tour}-effort` : undefined}
            />
          ) : (
            <MenuTrigger
              label="Reasoning effort"
              icon={Gauge}
              value={props.effortLabel(props.effort)}
              chevron={false}
              disabled={props.disabled}
              className="shrink-0"
              data-tour={props.tour ? `${props.tour}-effort` : undefined}
            />
          )}
          <DropdownMenuContent align="start" side="top" width="md" data-misty-layer-portal>
            <MenuLabel>Reasoning effort</MenuLabel>
            <MenuRadioGroup value={props.effort} onValueChange={props.onEffort}>
              {props.efforts.map((level) => {
                const note = props.effortNote?.(level);
                return (
                  <MenuRadioItem
                    key={level}
                    value={level}
                    label={props.effortLabel(level)}
                    state={note ? <Text tone="muted">{note}</Text> : undefined}
                  />
                );
              })}
            </MenuRadioGroup>
            {props.effortRows}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ModelList(props: ModelPickerProps) {
  const [open, setOpen] = React.useState(false);
  const models = props.models;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {props.mode === "icon" ? (
        <MenuTrigger
          kind="popover"
          label={`${props.label}: ${props.shown}`}
          iconOnly
          icon={props.icon}
          disabled={props.disabled}
          data-tour={props.tour}
        />
      ) : (
        <MenuTrigger
          kind="popover"
          label={props.label}
          icon={props.icon}
          value={props.shown}
          chevron={false}
          disabled={props.disabled}
          className="max-w-full"
          data-tour={props.tour}
        />
      )}
      <PopoverContent align="start" side="top" kind="flush" size="lg" data-misty-layer-portal>
        <Command label={props.label} defaultValue={props.value}>
          <CommandInput placeholder="Search models" aria-label="Search models" />
          <CommandList>
            {models === undefined ? (
              <SkeletonList
                label={props.label}
                rows={3}
                className="p-1"
                rowClassName="gap-2 px-2"
              />
            ) : (
              <>
                <CommandEmpty>
                  {models.length ? "No models match" : "This engine doesn't list its models"}
                </CommandEmpty>
                {/* Just the names and a check, after OpenChamber's: the level has its own
                    button, and a model picked runs at the engine's own level for it. The models
                    the engine's menu keeps aside stay under "More models" here too. */}
                {[
                  models.filter((model) => model.section !== "more"),
                  models.filter((model) => model.section === "more"),
                ].map((group, index) =>
                  group.length ? (
                    <CommandGroup key={index} heading={index ? "More models" : undefined}>
                      {group.map((model) => (
                        <CommandItem
                          key={model.value}
                          value={model.value}
                          keywords={[
                            model.label,
                            ...(model.detail ? [model.detail] : []),
                            ...(model.keywords ?? []),
                          ]}
                          label={model.label}
                          checked={model.value === props.value}
                          onSelect={() => {
                            setOpen(false);
                            props.onPick(model.value, props.effortFor(model.value));
                          }}
                        />
                      ))}
                    </CommandGroup>
                  ) : null,
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
