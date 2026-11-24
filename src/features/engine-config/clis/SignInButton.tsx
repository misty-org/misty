import { Globe, LogIn, MapPin, type LucideIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@misty/ui";

export interface SignInChoice {
  label: string;
  provider: string;
  icon?: LucideIcon;
}

const REGIONS: readonly SignInChoice[] = [
  { label: "Global account", provider: "global", icon: Globe },
  { label: "China account", provider: "cn", icon: MapPin },
];

export function signInChoices(engine: string): readonly SignInChoice[] | null {
  if (engine === "minimax" || engine === "kimi") return REGIONS;
  return null;
}

export function SignInButton({
  engine,
  label,
  disabled,
  size,
  onSignIn,
}: {
  engine: string;
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  onSignIn: (request: { provider?: string }) => void;
}) {
  const choices = signInChoices(engine);
  if (!choices) {
    return (
      <Button
        icon={LogIn}
        size={size}
        aria-label={label}
        disabled={disabled}
        onClick={() => onSignIn({})}
      >
        Sign in
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button icon={LogIn} size={size} aria-label={label} disabled={disabled}>
          Sign in
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((choice) => (
          <MenuItem
            key={choice.provider}
            icon={choice.icon}
            label={choice.label}
            onSelect={() => onSignIn({ provider: choice.provider })}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
