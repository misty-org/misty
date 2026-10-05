import {
  suggestedModel,
  type AIModelRoute,
  type AIProviderConnection,
  type AIProviderSettings,
} from "@/api/assistant/providers";
import { Input } from "@/shared/ui";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { DropdownControl } from "../SettingsControls";

/** Text-generation tasks that can share one model ID; the rest need specialized models. */
const languageRoles = new Set(["agent", "vision", "routing", "library", "library-fallback"]);

/** Points every task the connection supports at it, or every task back at Misty. */
export function routeAllTasks(
  routes: AIModelRoute[],
  settings: AIProviderSettings,
  connection?: AIProviderConnection,
): { routes: AIModelRoute[]; applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  const next = routes.map((route) => {
    const role = settings.roles.find((item) => item.id === route.role);
    if (!role) return route;
    if (!connection) {
      applied++;
      return {
        ...route,
        connection_id: "",
        model: "",
        reasoning: "",
        enabled: route.enabled || !role.optional,
      };
    }
    if (!role.providers.includes(connection.provider)) {
      skipped++;
      return route;
    }
    applied++;
    return {
      ...route,
      connection_id: connection.id,
      model: suggestedModel(connection.provider, role.id),
      reasoning: role.reasoning ? "low" : "",
      enabled: !role.optional,
    };
  });
  return { routes: next, applied, skipped };
}

/** The connection every enabled task uses, "server" for Misty, or "mixed". */
function sharedConnection(routes: AIModelRoute[], settings: AIProviderSettings): string {
  const enabled = routes.filter((route) => route.enabled);
  const ids = new Set(enabled.map((route) => route.connection_id).filter(Boolean));
  if (ids.size === 0) return "server";
  if (ids.size > 1) return "mixed";
  const [id] = ids as Set<string>;
  const connection = settings.connections.find((item) => item.id === id);
  if (!connection) return "mixed";
  const covered = enabled.every((route) => {
    const role = settings.roles.find((item) => item.id === route.role);
    return route.connection_id === id || !role?.providers.includes(connection.provider);
  });
  return covered ? id : "mixed";
}

export function AllTasksSection({
  settings,
  routes,
  disabled,
  onRoutesChange,
  onStatus,
}: {
  settings: AIProviderSettings;
  routes: AIModelRoute[];
  disabled: boolean;
  onRoutesChange(routes: AIModelRoute[]): void;
  onStatus(status: string): void;
}) {
  if (settings.connections.length === 0) return null;
  const value = sharedConnection(routes, settings);
  const connection = settings.connections.find((item) => item.id === value);
  const language = routes.filter(
    (route) => route.connection_id === value && languageRoles.has(route.role),
  );
  const models = new Set(language.map((route) => route.model));
  const model = models.size === 1 ? [...models][0]! : "";
  return (
    <Section title="All tasks">
      <Row
        label="Connection"
        description="Switches every task this connection supports. Tasks it cannot run keep their current choice."
      >
        <DropdownControl
          label="Connection for all tasks"
          value={value}
          disabled={disabled}
          options={[
            ...(value === "mixed" ? [{ value: "mixed", label: "Mixed", disabled: true }] : []),
            { value: "server", label: "Misty default" },
            ...settings.connections.map((item) => ({ value: item.id, label: item.name })),
          ]}
          onValueChange={(next) => {
            const target = settings.connections.find((item) => item.id === next);
            const result = routeAllTasks(routes, settings, target);
            onRoutesChange(result.routes);
            onStatus(
              target
                ? `${target.name} selected for ${result.applied} tasks` +
                    (result.skipped ? `; ${result.skipped} it cannot run kept their choice` : "") +
                    ". Save model choices to apply."
                : "Misty default selected for every task. Save model choices to apply.",
            );
          }}
        />
      </Row>
      {connection && language.length > 0 && (
        <Row
          label="Language model"
          description="Used for agent work, vision, routing and Library analysis. Voice, speech, embeddings and transcription keep their own models."
        >
          <Input
            aria-label="Language model for all tasks"
            placeholder={models.size > 1 ? "Different per task" : `${connection.provider}/model`}
            value={model}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              onRoutesChange(
                routes.map((route) =>
                  route.connection_id === value && languageRoles.has(route.role)
                    ? { ...route, model: next }
                    : route,
                ),
              );
            }}
          />
        </Row>
      )}
    </Section>
  );
}
