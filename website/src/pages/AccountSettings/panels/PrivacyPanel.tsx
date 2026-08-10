import { customRowClass, Row, Section } from "../components/SettingsRows";
import { DataSharing } from "./DataSharing";

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

      <Section title="Data sharing">
        <DataSharing />
      </Section>

      <Section title="Legal">
        <Row label="Privacy Policy">
          <a className="underline underline-offset-4" href="/privacy">
            Read
          </a>
        </Row>
        <Row label="Terms of Service">
          <a className="underline underline-offset-4" href="/terms">
            Read
          </a>
        </Row>
        <Row label="License Agreement">
          <a className="underline underline-offset-4" href="/license">
            Read
          </a>
        </Row>
      </Section>
    </div>
  );
}
