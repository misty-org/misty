import { cn, DropdownMenu, DropdownMenuContent, MenuItem, MenuTrigger } from "@/shared/ui";
import { Check, ChevronDown, Mic } from "lucide-react";
import type { AiVoiceInputDevice } from "./useAiVoiceRecorder";

export function VoiceInputMenu(props: {
  devices: AiVoiceInputDevice[];
  selectedDeviceId: string;
  disabled?: boolean;
  compact?: boolean;
  labeled?: boolean;
  onRefresh: () => void;
  onSelect: (deviceId: string) => void;
}) {
  const selected = props.devices.find((device) => device.deviceId === props.selectedDeviceId);
  const selectedLabel = selected?.label ?? "System default";

  return (
    <DropdownMenu onOpenChange={(open) => open && props.onRefresh()}>
      {props.labeled ? (
        <MenuTrigger
          label={`Choose microphone. Current input: ${selectedLabel}`}
          value={selectedLabel}
          title={`Microphone: ${selectedLabel}`}
          disabled={props.disabled}
          className="max-w-52 text-xs"
        />
      ) : (
        <MenuTrigger
          iconOnly
          size="xs"
          label={`Choose microphone. Current input: ${selectedLabel}`}
          title={`Microphone: ${selectedLabel}`}
          disabled={props.disabled}
          className={cn("h-8 w-6 rounded-lg", props.compact && "h-7 w-5 rounded-full")}
          icon={<ChevronDown className="size-3.5" />}
        />
      )}
      <DropdownMenuContent align="start" sideOffset={7} width="xl" data-misty-layer-portal>
        <MenuItem
          icon={<Mic />}
          label="System default"
          shortcut={!props.selectedDeviceId ? <Check className="size-3.5" /> : undefined}
          onSelect={() => props.onSelect("")}
        />
        {props.devices.map((device) => (
          <MenuItem
            key={device.deviceId}
            icon={<Mic />}
            label={device.label}
            shortcut={
              props.selectedDeviceId === device.deviceId ? (
                <Check className="size-3.5" />
              ) : undefined
            }
            onSelect={() => props.onSelect(device.deviceId)}
          />
        ))}
        {!props.devices.length ? (
          <div className="px-2 py-2 text-xs text-cream-muted">
            Allow microphone access to see available inputs.
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
