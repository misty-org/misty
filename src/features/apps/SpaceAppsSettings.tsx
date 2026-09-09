import { SpaceAppConnections } from "./SpaceAppConnections";
import { useAuth } from "@/features/auth";
import { useSpacesStore } from "@/features/spaces/core";
import { appsApi } from "@/api/apps";
import { personalSpaceTemplatesApi, type PersonalSpaceTemplate } from "@/api/spaces/templates";
import { Button, Input } from "@/shared/ui";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { canManageSpaceApps, useAppsStore } from "./useAppsStore";

export function SpaceAppsSettings({ spaceId }: { spaceId: string }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const space = useSpacesStore((state) => state.spaces.find((item) => item.id === spaceId));
  const all = useAppsStore((state) => state.bySpace);
  const catalog = useAppsStore((state) => state.catalog);
  const apps = all[spaceId] ?? [];
  const manager = canManageSpaceApps(spaceId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<PersonalSpaceTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (user?.id) void useAppsStore.getState().load(user.id, true, spaceId);
    void personalSpaceTemplatesApi
      .list()
      .then((result) => setTemplates(result.templates))
      .catch((error: unknown) => setError(String(error)));
  }, [spaceId, user?.id]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (user?.id) await useAppsStore.getState().load(user.id, true, spaceId);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const move = (id: string, offset: number) => {
    const ids = apps.filter((app) => app.state === "installed").map((app) => app.app_id);
    const from = ids.indexOf(id),
      to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void run(() => appsApi.reorder(spaceId, ids));
  };
  return (
    <div className="space-y-5 p-5">
      <div>
        <h2 className="text-lg font-semibold">Manage apps</h2>
        <p className="mt-1 text-sm text-cream-muted">
          Tools available to everyone in {space?.name ?? "this Space"}.
        </p>
      </div>
      {!apps.some((app) => app.state === "installed") && (
        <p className="text-sm text-cream-muted">
          {manager
            ? "Choose apps for this Space."
            : "A Space manager needs to choose apps for this environment."}
        </p>
      )}
      {!manager && (
        <p className="text-sm text-cream-muted">Ask a Space manager to change these apps.</p>
      )}
      {manager && <Button onClick={() => navigate("/discover")}>Add apps</Button>}
      <div className="divide-y divide-charcoal-border">
        {apps.map((app) => (
          <div key={app.app_id} className="flex flex-wrap items-center gap-2 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {catalog.find((item) => item.id === app.app_id)?.name ?? app.app_id}
              </p>
              <p className="text-xs text-cream-muted">
                {app.state === "installed"
                  ? `Version ${app.installed_version}`
                  : "Removed · content retained"}
              </p>
            </div>
            {manager && app.state === "installed" && (
              <>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Move ${app.app_id} up`}
                  onClick={() => move(app.app_id, -1)}
                >
                  <ArrowUp size={16} />
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Move ${app.app_id} down`}
                  onClick={() => move(app.app_id, 1)}
                >
                  <ArrowDown size={16} />
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => appsApi.uninstall(spaceId, app.app_id))}
                >
                  Remove from {space?.name}
                </Button>
              </>
            )}
            {app.state === "installed" &&
              app.granted_scopes.some((scope) => scope.startsWith("connections.")) && (
                <SpaceAppConnections
                  key={`${spaceId}:${app.app_id}`}
                  spaceId={spaceId}
                  appId={app.app_id}
                />
              )}
            {manager && app.state !== "installed" && (
              <Button
                variant="outline"
                onClick={() => navigate(`/discover?app=${encodeURIComponent(app.app_id)}`)}
              >
                Review and restore
              </Button>
            )}
          </div>
        ))}
      </div>
      {manager && (
        <form
          className="space-y-3 border-t border-charcoal-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await personalSpaceTemplatesApi.save(
                { name, description, space_id: spaceId },
                templateId || undefined,
              );
              setTemplates((await personalSpaceTemplatesApi.list()).templates);
              setNotice("Template saved. It contains apps and their order only.");
            });
          }}
        >
          <h3 className="text-sm font-medium">Save as a personal template</h3>
          <p className="text-xs text-cream-muted">
            Save apps and their order. Content, accounts, and permissions are not copied.
          </p>
          <label className="grid gap-1 text-sm">
            Template
            <select
              className="rounded border border-charcoal-border bg-charcoal-bg p-2"
              value={templateId}
              onChange={(event) => {
                const id = event.target.value;
                setTemplateId(id);
                const template = templates.find((item) => item.id === id);
                setName(template?.name ?? "");
                setDescription(template?.description ?? "");
              }}
            >
              <option value="">New template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Name
            <Input
              maxLength={80}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Description
            <Input
              maxLength={1000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !name.trim()}>
              {templateId ? "Replace template setup" : "Save template"}
            </Button>
            {templateId && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await personalSpaceTemplatesApi.remove(templateId);
                    setTemplates(templates.filter((item) => item.id !== templateId));
                    setTemplateId("");
                    setName("");
                    setDescription("");
                  })
                }
              >
                Delete template
              </Button>
            )}
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-cream-muted">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-cream-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
