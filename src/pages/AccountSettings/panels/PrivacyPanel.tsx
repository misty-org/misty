import {
  customRowClass,
  GhostRow,
  Section,
} from "../components/SettingsRows";

export function PrivacyPanel() {
  return (
    <div>
      <Section title="Privacy">
        <div className={`${customRowClass} flex flex-col gap-2`}>
          <p className="text-sm font-medium text-foreground">
            Private Files and shared Space content are handled differently.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Private Files operations stay local unless you connect a provider or
            explicitly add content to a Space. Shared Library content is stored
            for that Space, and agents may use context you are permitted to
            access. Billing records do not contain prompts or file contents.
          </p>
        </div>
      </Section>

      <Section title="Legal">
        <GhostRow label="Privacy Policy" value="Coming soon" />
        <GhostRow label="Terms of Service" value="Coming soon" />
        <GhostRow label="License Agreement" value="Coming soon" />
      </Section>
    </div>
  );
}
