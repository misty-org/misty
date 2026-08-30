import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@/shared/ui";
import { Check, ChevronDown, Mic } from "lucide-react";
import type { AiVoiceInputDevice } from "./useAiVoiceRecorder";

export function VoiceInputMenu(props: {
  devices: AiVoiceInputDevice[];
  selectedDeviceId: string;
  disabled?: boolean;
  compact?: boolean;
  onRefresh: () => void;
  onSelect: (deviceId: string) => void;
}) {
  const selected = props.devices.find((device) => device.deviceId === props.selectedDeviceId);
  const selectedLabel = selected?.label ?? "System default";

  return (
    <DropdownMenu onOpenChange={(open) => open && props.onRefresh()}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={props.disabled}
          className={cn(
            "h-8 w-6 shrink-0 rounded-lg text-cream-muted hover:bg-white/[0.06] hover:text-cream",
            props.compact && "h-7 w-5 rounded-full",
          )}
          aria-label={`Choose microphone. Current input: ${selectedLabel}`}
          title={`Microphone: ${selectedLabel}`}
        >
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={7} className="w-72" data-misty-layer-portal>
        <DropdownMenuItem onSelect={() => props.onSelect("")}>
          <Mic className="size-4" />
          <span className="min-w-0 flex-1 truncate">System default</span>
          {!props.selectedDeviceId ? <Check className="size-3.5" /> : null}
        </DropdownMenuItem>
        {props.devices.map((device) => (
          <DropdownMenuItem key={device.deviceId} onSelect={() => props.onSelect(device.deviceId)}>
            <Mic className="size-4" />
            <span className="min-w-0 flex-1 truncate">{device.label}</span>
            {props.selectedDeviceId === device.deviceId ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
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
