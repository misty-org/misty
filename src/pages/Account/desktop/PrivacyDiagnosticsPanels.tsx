import { useEffect, useState } from "react";

import { downloadSupportBundle } from "@/features/support/supportBundle";
import type { ClientDebugEvent } from "@/models/interfaces/platform/clientDebug";
import {
  clearClientDebugEvents,
  clientDebugPanelEnabled,
  readClientDebugEvents,
} from "@/platform/clientDebug";
import { openExternalLink } from "@/platform/openExternalLink";
import { useAppStore } from "@/stores/app";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";
import { Button } from "@/ui";
import { DesktopSettingsRow, DesktopSettingsSection } from "../../Settings/DesktopSettingsUI";

const customRowClass = "border-b border-border/60 px-5 py-4 last:border-b-0";
const eventDetailClass =
  "max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <DesktopSettingsSection title={title}>{children}</DesktopSettingsSection>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DesktopSettingsRow label={label}>
      <span className="text-right text-sm text-foreground max-[760px]:text-left">{children}</span>
    </DesktopSettingsRow>
  );
}

function ExternalResourceRow({ label, url }: { label: string; url?: string }) {
  return url ? (
    <DesktopSettingsRow label={label}>
      <Button
        type="button"
        variant="link"
        className="h-auto p-0"
        onClick={() => void openExternalLink(url)}
      >
        Open
      </Button>
    </DesktopSettingsRow>
  ) : (
    <DesktopSettingsRow label={label} muted>
      <span className="italic text-muted-foreground">Available before public beta</span>
    </DesktopSettingsRow>
  );
}

function eventLevelClass(level: ClientDebugEvent["level"]): string {
  if (level === "error") return "text-destructive";
  if (level === "warn") return "text-[var(--misty-warning)]";
  return "text-foreground";
}

export function PrivacyPanel() {
  return (
    <div>
      <Section title="Privacy">
        <div className={`${customRowClass} flex flex-col gap-2`}>
          <p className="text-sm font-medium text-foreground">
            Private by default, explicit when shared.
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Files and local provider access stay private until you choose an action that uploads or
            shares content. Space Library copies, Chat attachments, account data, agent prompts and
            selected context, and supported integration credentials may be sent to the configured
            Misty service or provider to perform that action. Misty shows the destination before a
            private file becomes shared Space content.
          </p>
        </div>
      </Section>

      <Section title="Legal">
        <ExternalResourceRow label="Privacy Policy" url={import.meta.env.VITE_PRIVACY_POLICY_URL} />
        <ExternalResourceRow label="Terms of Service" url={import.meta.env.VITE_TERMS_URL} />
        <ExternalResourceRow
          label="Desktop License"
          url={import.meta.env.VITE_DESKTOP_LICENSE_URL}
        />
      </Section>

      <Section title="Contact">
        <ExternalResourceRow label="Support and feedback" url={import.meta.env.VITE_SUPPORT_URL} />
        <ExternalResourceRow
          label="Report a security issue"
          url={import.meta.env.VITE_SECURITY_URL}
        />
      </Section>
    </div>
  );
}

export function DiagnosticsPanel() {
  const app = useAppStore((state) => state.app);
  const [events, setEvents] = useState<ClientDebugEvent[]>(() => readClientDebugEvents());
  const [supportBundleWorking, setSupportBundleWorking] = useState(false);
  const [supportBundleError, setSupportBundleError] = useState("");
  const serverBase = withDefaultApiPath(
    normalizeApiBaseUrl(
      import.meta.env.VITE_MISTY_PUBLIC_API_URL ||
        import.meta.env.VITE_MISTY_SERVER_URL ||
        import.meta.env.VITE_API_BASE ||
        app?.environment.serverUrl ||
        null,
    ),
  );

  useEffect(() => {
    function refresh() {
      setEvents(readClientDebugEvents());
    }
    window.addEventListener("misty-client-debug", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("misty-client-debug", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div>
      <Section title="Runtime">
        <Row label="Misty server API">{serverBase || "Not set"}</Row>
        <Row label="Server env">
          {import.meta.env.VITE_MISTY_PUBLIC_API_URL ||
            import.meta.env.VITE_MISTY_SERVER_URL ||
            import.meta.env.VITE_API_BASE ||
            "Not set"}
        </Row>
        <Row label="Debug logging">{clientDebugPanelEnabled() ? "Enabled" : "Disabled"}</Row>
      </Section>

      <Section title="Client Events">
        {events.length > 0 ? (
          <div className="divide-y divide-border/60 px-7">
            {events.slice(0, 12).map((event) => (
              <article key={event.id} className="grid gap-1 py-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <strong className={`text-sm ${eventLevelClass(event.level)}`}>
                    {event.scope}
                  </strong>
                  <time className="shrink-0 text-xs text-muted-foreground">
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </time>
                </div>
                <p className="m-0 text-sm text-muted-foreground">{event.message}</p>
                {event.detail ? <pre className={eventDetailClass}>{event.detail}</pre> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className={customRowClass}>
            <p className="m-0 text-sm text-muted-foreground">No client events recorded yet.</p>
          </div>
        )}
        <div className={`${customRowClass} flex justify-end`}>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              clearClientDebugEvents();
              setEvents([]);
            }}
          >
            Clear debug events
          </Button>
        </div>
      </Section>

      <Section title="Support bundle">
        <div className={`${customRowClass} flex flex-col gap-3`}>
          <div>
            <p className="m-0 text-sm text-foreground">Create a diagnostic file</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Misty builds this file locally from app version details and redacted client events.
              Nothing is uploaded automatically. Review it before choosing to share it with support.
            </p>
          </div>
          {supportBundleError ? (
            <p className="m-0 text-sm text-destructive" role="alert">
              {supportBundleError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={supportBundleWorking}
              onClick={() => {
                setSupportBundleError("");
                setSupportBundleWorking(true);
                void downloadSupportBundle()
                  .catch((error) => {
                    setSupportBundleError(
                      error instanceof Error ? error.message : "Could not create support bundle.",
                    );
                  })
                  .finally(() => setSupportBundleWorking(false));
              }}
            >
              {supportBundleWorking ? "Creating…" : "Download support bundle"}
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
