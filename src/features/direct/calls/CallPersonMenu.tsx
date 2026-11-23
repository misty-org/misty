import { Hand, Maximize2, MicOff, Minimize2, MoreHorizontal, UserMinus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  MenuCheckItem,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@misty/ui";
import type { CallControls, CallPerson } from "./use_live_kit_call";

const volumeLevels = [
  { value: "1.5", label: "150%" },
  { value: "1", label: "100%" },
  { value: "0.5", label: "50%" },
  { value: "0.25", label: "25%" },
];

export function CallPersonMenu({
  person,
  controls,
  focused,
  onFocus,
  moderator,
}: {
  person: CallPerson;
  controls: CallControls;
  focused: boolean;
  onFocus: () => void;
  moderator: boolean;
}) {
  const silenced = person.volume === 0;
  return (
    <DropdownMenu>
      <MenuTrigger iconOnly icon={MoreHorizontal} label="More" />
      <DropdownMenuContent align="end">
        <MenuItem
          icon={focused ? Minimize2 : Maximize2}
          label={focused ? "Show everyone" : "Focus"}
          onSelect={onFocus}
        />
        {person.self ? null : (
          <>
            <MenuSeparator />
            <MenuLabel>Volume for you</MenuLabel>
            <MenuRadioGroup
              value={silenced ? "" : String(person.volume)}
              onValueChange={(value) => controls.setVolume(person.id, Number(value))}
            >
              {volumeLevels.map((level) => (
                <MenuRadioItem key={level.value} value={level.value} label={level.label} />
              ))}
            </MenuRadioGroup>
            <MenuCheckItem
              label="Mute for me"
              checked={silenced}
              onCheckedChange={(on) => controls.setVolume(person.id, on ? 0 : 1)}
            />
            {moderator ? (
              <>
                <MenuSeparator />
                {person.hand ? (
                  <MenuItem
                    icon={Hand}
                    label="Lower their hand"
                    onSelect={() => controls.lowerHandOf(person.id)}
                  />
                ) : null}
                {person.micOn ? (
                  <MenuItem
                    icon={MicOff}
                    label="Mute for everyone"
                    onSelect={() => controls.moderate(person.id, "mute")}
                  />
                ) : null}
                <MenuItem
                  icon={UserMinus}
                  label="Remove from call"
                  danger
                  onSelect={() => controls.moderate(person.id, "remove")}
                />
              </>
            ) : null}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
