import {
  aiProvidersApi,
  providerBases,
  providerLabels,
  suggestedModel,
  validRoute,
  type AIModelRoute,
  type AIProvider,
  type AIProviderSettings,
} from "@/api/assistant/providers";
import { Button, Input } from "@/shared/ui";
import { useEffect, useState } from "react";
import {
  DesktopSettingsRow as Row,
  DesktopSettingsSection as Section,
} from "../components/DesktopSettingsUI";
import { DropdownControl, SettingsNote } from "../SettingsControls";

function initialRoutes(settings: AIProviderSettings): AIModelRoute[] {
  return settings.roles.map(
    (role) =>
      settings.routes.find((route) => route.role === role.id) ?? {
        role: role.id,
        connection_id: "",
        model: "",
        reasoning: "",
        enabled: true,
      },
  );
}

export function ModelProvidersSection() {
  const [settings, setSettings] = useState<AIProviderSettings>();
  const [routes, setRoutes] = useState<AIModelRoute[]>([]);
  const [savedRoutes, setSavedRoutes] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [provider, setProvider] = useState<AIProvider>("openai");
  const [name, setName] = useState("");
  const [base, setBase] = useState("");
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState("");
  const [replacementKey, setReplacementKey] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void aiProvidersApi
      .settings()
      .then((data) => {
        if (!active) return;
        setSettings(data);
        const values = initialRoutes(data);
        setRoutes(values);
        setSavedRoutes(JSON.stringify(values));
      })
      .catch(() => {
        if (active) setError("Could not load provider settings. Retry to reconnect.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const dirty = JSON.stringify(routes) !== savedRoutes;
  const changeRoute = (role: string, change: Partial<AIModelRoute>) => {
    setStatus("");
    setRoutes((current) =>
      current.map((route) => (route.role === role ? { ...route, ...change } : route)),
    );
  };
  const perform = async (action: () => Promise<void>) => {
    setWorking(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the change. Try again.");
    } finally {
      setWorking(false);
    }
  };
  if (loading)
    return (
      <p role="status" className="text-sm text-cream-muted">
        Loading provider settings…
      </p>
    );
  if (!settings)
    return (
      <div className="grid justify-items-start gap-3">
        <p role="alert" className="text-sm text-cream">
          {error}
        </p>
        <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );
  const disabled = working;
  return (
    <>
      {error && (
        <p role="alert" className="mb-4 text-sm text-cream">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mb-4 text-sm text-cream-muted">
          {status}
        </p>
      )}
      <Section
        title="Provider connections"
        description={
          "Use your own provider credits. Connections belong to your account and work across " +
          "devices. Keys are encrypted on the server and are never shown again."
        }
      >
        {settings.connections.length === 0 && (
          <SettingsNote>
            Add a connection below to use your own API key. Tasks use Misty’s configured provider
            until you choose a connection.
          </SettingsNote>
        )}
        {settings.connections.map((connection) => {
          const used =
            routes.some((route) => route.enabled && route.connection_id === connection.id) ||
            JSON.parse(savedRoutes).some(
              (route: AIModelRoute) => route.enabled && route.connection_id === connection.id,
            );
          return (
            <Row
              key={connection.id}
              label={connection.name}
              description={`${providerLabels[connection.provider]} · ${connection.base_url}`}
            >
              <div className="grid min-w-0 gap-2">
                <div className="flex flex-wrap justify-end gap-2 max-[760px]:justify-start">
                  {connection.provider === "openai" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() => {
                        setRoutes((current) =>
                          current.map((route) => {
                            const role = settings.roles.find((item) => item.id === route.role)!;
                            return role.providers.includes("openai")
                              ? {
                                  ...route,
                                  connection_id: connection.id,
                                  model: suggestedModel("openai", role.id),
                                  reasoning: role.reasoning ? "low" : "",
                                  enabled: !role.optional,
                                }
                              : route;
                          }),
                        );
                        setStatus("OpenAI defaults selected. Save model choices to apply them.");
                      }}
                    >
                      Use OpenAI defaults
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => {
                      setReplacing(connection.id);
                      setReplacementKey("");
                    }}
                  >
                    Replace key
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || used}
                    title={
                      used ? "Save another connection for its tasks before removing it." : undefined
                    }
                    onClick={() =>
                      void perform(async () => {
                        await aiProvidersApi.remove(connection.id);
                        const clear = (values: AIModelRoute[]) =>
                          values.map((route) =>
                            route.connection_id === connection.id
                              ? { ...route, connection_id: "", model: "", reasoning: "" }
                              : route,
                          );
                        setRoutes(clear);
                        setSavedRoutes((current) => JSON.stringify(clear(JSON.parse(current))));
                        setSettings(
                          (current) =>
                            current && {
                              ...current,
                              connections: current.connections.filter(
                                (item) => item.id !== connection.id,
                              ),
                            },
                        );
                        setStatus("Connection removed.");
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                {replacing === connection.id && (
                  <form
                    className="grid gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void perform(async () => {
                        await aiProvidersApi.rotateKey(connection.id, replacementKey);
                        setReplacementKey("");
                        setReplacing("");
                        setStatus("API key replaced.");
                      });
                    }}
                  >
                    <Input
                      type="password"
                      aria-label={`New API key for ${connection.name}`}
                      autoComplete="new-password"
                      value={replacementKey}
                      onChange={(event) => setReplacementKey(event.target.value)}
                      disabled={disabled}
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={
                          disabled ||
                          (!replacementKey.trim() && connection.provider !== "openai-compatible")
                        }
                      >
                        Save key
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                          setReplacing("");
                          setReplacementKey("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            </Row>
          );
        })}
      </Section>
      <form
        className="mb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void perform(async () => {
            const connection = await aiProvidersApi.create({
              name: name.trim() || providerLabels[provider],
              provider,
              base_url: base.trim(),
              api_key: key.trim(),
            });
            setKey("");
            setName("");
            setBase("");
            setSettings(
              (current) =>
                current && { ...current, connections: [...current.connections, connection] },
            );
            setStatus("Connection saved. Choose it for the tasks below.");
          });
        }}
      >
        <Section title="Add a provider">
          <Row label="Provider">
            <DropdownControl
              value={provider}
              disabled={disabled}
              options={(Object.keys(providerLabels) as AIProvider[]).map((value) => ({
                value,
                label: providerLabels[value],
              }))}
              onValueChange={(value) => {
                setProvider(value as AIProvider);
                setBase("");
              }}
            />
          </Row>
          <Row label="Connection name">
            <Input
              aria-label="Connection name"
              placeholder={providerLabels[provider]}
              value={name}
              maxLength={80}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </Row>
          <Row
            label="Base URL"
            description="Public HTTPS endpoint. Leave blank to use the provider’s standard endpoint."
          >
            <Input
              aria-label="Provider base URL"
              placeholder={providerBases[provider]}
              type="url"
              value={base}
              disabled={disabled}
              onChange={(event) => setBase(event.target.value)}
            />
          </Row>
          <Row
            label="API key"
            description={
              provider === "openai-compatible"
                ? "Optional for endpoints that do not require a key."
                : undefined
            }
          >
            <Input
              aria-label="Provider API key"
              type="password"
              autoComplete="new-password"
              value={key}
              disabled={disabled}
              onChange={(event) => setKey(event.target.value)}
            />
          </Row>
          <div className="flex justify-end px-5 py-3">
            <Button
              type="submit"
              variant="outline"
              disabled={
                disabled ||
                settings.connections.length >= 20 ||
                (!key.trim() && provider !== "openai-compatible") ||
                (provider === "openai-compatible" && !base.trim())
              }
            >
              Add connection
            </Button>
          </div>
        </Section>
      </form>
      {[
        { title: "Agent models", roles: settings.roles.slice(0, 4) },
        { title: "Library and media models", roles: settings.roles.slice(4) },
      ].map((group) => (
        <Section
          key={group.title}
          title={group.title}
          description="Choose a connection and enter its model ID. Provider capabilities determine which connections are available. Changes apply to new tasks."
        >
          {group.roles.map((role) => {
            const route = routes.find((item) => item.role === role.id)!;
            const connection = settings.connections.find((item) => item.id === route.connection_id);
            const defaultModel = settings.defaults.find((item) => item.role === role.id)?.model;
            return (
              <Row key={role.id} label={role.name} description={role.description}>
                <div className="grid min-w-0 gap-2">
                  <DropdownControl
                    label={`${role.name} connection`}
                    value={!route.enabled ? "disabled" : route.connection_id || "server"}
                    disabled={disabled}
                    options={[
                      { value: "server", label: "Misty default" },
                      ...settings.connections
                        .filter((item) => role.providers.includes(item.provider))
                        .map((item) => ({ value: item.id, label: item.name })),
                      ...(route.connection_id && !connection
                        ? [
                            {
                              value: route.connection_id,
                              label: "Connection unavailable",
                              disabled: true,
                            },
                          ]
                        : []),
                      {
                        value: "disabled",
                        label: role.optional ? "Disabled · no extra request" : "Disabled",
                      },
                    ]}
                    onValueChange={(value) => {
                      if (value === "disabled") {
                        changeRoute(role.id, { enabled: false });
                        return;
                      }
                      const next = settings.connections.find((item) => item.id === value);
                      changeRoute(role.id, {
                        enabled: true,
                        connection_id: next?.id ?? "",
                        model: next ? suggestedModel(next.provider, role.id) : "",
                        reasoning: next && role.reasoning ? "low" : "",
                      });
                    }}
                  />
                  <Input
                    aria-label={`${role.name} model ID`}
                    placeholder={defaultModel || "provider/model"}
                    value={route.model}
                    disabled={disabled || !route.enabled || !connection}
                    aria-invalid={!validRoute(route) || undefined}
                    onChange={(event) => changeRoute(role.id, { model: event.target.value })}
                  />
                  {role.reasoning && (
                    <DropdownControl
                      label={`${role.name} reasoning`}
                      value={route.reasoning || "default"}
                      disabled={disabled || !route.enabled || !connection}
                      options={[
                        { value: "default", label: "Model default" },
                        { value: "none", label: "None" },
                        { value: "low", label: "Low" },
                        { value: "medium", label: "Medium" },
                        { value: "high", label: "High" },
                        { value: "xhigh", label: "Extra high" },
                        ...(connection?.provider === "openai" ||
                        (connection?.provider === "gateway" && route.model.startsWith("openai/"))
                          ? [{ value: "max", label: "Maximum" }]
                          : []),
                      ]}
                      onValueChange={(value) =>
                        changeRoute(role.id, { reasoning: value === "default" ? "" : value })
                      }
                    />
                  )}
                  {!validRoute(route) && (
                    <p className="text-xs text-cream-muted">Enter a complete provider/model ID.</p>
                  )}
                </div>
              </Row>
            );
          })}
        </Section>
      ))}
      <div className="flex flex-wrap items-center justify-end gap-3 pb-4">
        <span className="mr-auto text-xs text-cream-muted">
          {dirty ? "Unsaved model choices" : status === "Model choices saved." ? "Saved" : ""}
        </span>
        <Button
          variant="ghost"
          disabled={disabled || !dirty}
          onClick={() => {
            setRoutes(JSON.parse(savedRoutes));
            setStatus("");
            setError("");
          }}
        >
          Discard changes
        </Button>
        <Button
          variant="outline"
          disabled={disabled || !dirty || routes.some((route) => !validRoute(route))}
          onClick={() =>
            void perform(async () => {
              await aiProvidersApi.saveRoutes(routes);
              setSavedRoutes(JSON.stringify(routes));
              setStatus("Model choices saved.");
            })
          }
        >
          {working ? "Saving…" : "Save model choices"}
        </Button>
      </div>
    </>
  );
}
