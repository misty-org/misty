import { DropdownMenuRadioGroup, DropdownMenuRadioItem, MenuSubmenu } from "@/shared/ui";
import { Laptop, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import type { ComponentType } from "react";
import type {
  BrowserViewport,
  BrowserViewportDevice,
  BrowserViewportSize,
} from "./browserViewport";
import { BrowserViewportSizeSliders } from "./BrowserViewportSizeSliders";
export * from "./browserViewport";
const viewportOptions: Array<{
  id: BrowserViewport;
  label: string;
  icon: ComponentType<{
    size?: number;
    strokeWidth?: number;
  }>;
}> = [
  {
    id: "responsive",
    label: "Responsive",
    icon: MonitorSmartphone,
  },
  {
    id: "desktop",
    label: "Desktop",
    icon: Laptop,
  },
  {
    id: "tablet",
    label: "Tablet",
    icon: Tablet,
  },
  {
    id: "mobile",
    label: "Mobile",
    icon: Smartphone,
  },
];
/** The Viewport submenu of the browser menu; the chosen device shows its size sliders. */
export function BrowserViewportMenuView(props: {
  value: BrowserViewport;
  onChange: (value: BrowserViewport) => void;
  sizes: Record<BrowserViewportDevice, BrowserViewportSize>;
  onSizeChange: (device: BrowserViewportDevice, size: BrowserViewportSize) => void;
}) {
  const active = viewportOptions.find((option) => option.id === props.value) ?? viewportOptions[0];
  const ActiveIcon = active.icon;
  return (
    <MenuSubmenu icon={<ActiveIcon />} label="Viewport" width="md">
      <DropdownMenuRadioGroup
        value={props.value}
        onValueChange={(value) => props.onChange(value as BrowserViewport)}
      >
        {viewportOptions.map((option) => {
          const Icon = option.icon;
          const selected = option.id === props.value;
          const size = option.id === "responsive" ? null : props.sizes[option.id];
          return (
            <div key={option.id}>
              <DropdownMenuRadioItem value={option.id} onSelect={(event) => event.preventDefault()}>
                <Icon />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </DropdownMenuRadioItem>
              {selected && size ? (
                <BrowserViewportSizeSliders
                  device={option.id as BrowserViewportDevice}
                  size={size}
                  onChange={(next) => props.onSizeChange(option.id as BrowserViewportDevice, next)}
                />
              ) : null}
            </div>
          );
        })}
      </DropdownMenuRadioGroup>
    </MenuSubmenu>
  );
}
