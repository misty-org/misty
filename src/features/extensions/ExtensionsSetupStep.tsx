import { Check, KeyRound, ShieldCheck, type LucideIcon } from "lucide-react";
import { useDevicePreferences } from "@/features/settings";
import { Button, SkeletonList } from "@/shared/ui";
import {
  parseInstallations,
  requestInstall,
  spaceInstallationsRaw,
  useExtensionsStore,
} from "./store";

interface Choice {
  /** The extension's Chrome Web Store ID. */
  id: string;
  name: string;
  detail: string;
}

const groups: { label: string; icon: LucideIcon; choices: Choice[] }[] = [
  {
    label: "Ad blocker",
    icon: ShieldCheck,
    choices: [
      {
        id: "ddkjiahejlhfcafbddmgiahcphecmpfh",
        name: "uBlock Origin Lite",
        detail: "Blocks ads and trackers on every site.",
      },
    ],
  },
  {
    label: "Password manager",
    icon: KeyRound,
    choices: [
      {
        id: "nngceckbapebfimnlniiiahkandclblb",
        name: "Bitwarden",
        detail: "Free and open source. Signs in with your Bitwarden account.",
      },
      {
        id: "aeblfdkhhhdcdjpifhhbdiojplfjncoa",
        name: "1Password",
        detail: "Some features need the 1Password app and may not work yet.",
      },
    ],
  },
];

/**
 * First-run setup: optional extensions for blocking ads and saving passwords.
 * Misty adds each one through the same install review as "Add to Misty" on a
 * store page; nothing is added until the person chooses it.
 */
export function ExtensionsSetupStep() {
  const ready = useExtensionsStore((state) => state.ready);
  const profile = useDevicePreferences((state) => state.state);
  const installed = new Set(
    parseInstallations(spaceInstallationsRaw(profile))
      .filter((item) => item.installed)
      .map((item) => item.id),
  );
  if (!ready) return <SkeletonList label="Extensions" rows={3} trailing />;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-cream-muted">
            <group.icon aria-hidden="true" className="size-3.5" />
            {group.label}
          </h3>
          <ul className="mt-2 divide-y divide-charcoal-border rounded-lg border border-charcoal-border">
            {group.choices.map((choice) => (
              <li key={choice.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-cream-bright">{choice.name}</span>
                  <span className="block text-xs leading-snug text-cream-muted">
                    {choice.detail}
                  </span>
                </span>
                {installed.has(choice.id) ? (
                  <span className="flex items-center gap-1 text-xs text-cream-muted">
                    <Check aria-hidden="true" className="size-4" />
                    Added
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Add ${choice.name}`}
                    onClick={() => requestInstall(choice.id)}
                  >
                    Add
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
