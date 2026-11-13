/**
 * The Sign in button for an engine CLI. Where the CLI's sign-in starts with a choice (MiniMax
 * Code's and Kimi Code's region, Pi's and Oh My Pi's provider), the choice is Misty's own menu
 * here, so the CLI's sign-in can open the browser directly instead of asking in its terminal.
 */
import { Globe, LogIn, MapPin, type LucideIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuItem,
} from "@/shared/ui";
import { PI_FAMILY_OAUTH_PROVIDERS } from "../engine-setup/piFamilyAuthCatalog";

export interface SignInChoice {
  label: string;
  /** What the sign-in is started with (`SignInRequest.provider`). */
  provider: string;
  icon?: LucideIcon;
}

const REGIONS: readonly SignInChoice[] = [
  { label: "Global account", provider: "global", icon: Globe },
  { label: "China account", provider: "cn", icon: MapPin },
];

/** What the person picks before an engine's sign-in starts, or null when it starts at once. */
export function signInChoices(engine: string): readonly SignInChoice[] | null {
  if (engine === "minimax" || engine === "kimi") return REGIONS;
  if (engine === "pi" || engine === "omp") {
    // Providers are like things: their names alone, no repeated icon.
    return PI_FAMILY_OAUTH_PROVIDERS[engine].map((item) => ({
      label: item.name,
      provider: item.loginArg,
    }));
  }
  return null;
}

/** The name the dialog uses for a sign-in's provider, when the person picked one here. */
export function signInChoiceLabel(engine: string, provider: string | undefined): string | null {
  if (!provider) return null;
  return signInChoices(engine)?.find((choice) => choice.provider === provider)?.label ?? null;
}

export function SignInButton({
  engine,
  label,
  disabled,
  onSignIn,
}: {
  engine: string;
  /** The button's accessible name, when "Sign in" alone doesn't say what for. */
  label?: string;
  disabled?: boolean;
  onSignIn: (request: { provider?: string }) => void;
}) {
  const choices = signInChoices(engine);
  if (!choices) {
    return (
      <Button icon={LogIn} aria-label={label} disabled={disabled} onClick={() => onSignIn({})}>
        Sign in
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button icon={LogIn} aria-label={label} disabled={disabled}>
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
