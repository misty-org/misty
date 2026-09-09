import type { OfficialApp } from "@/api/apps";
import { appPermissionLabel } from "@/features/apps/appPermissions";
import { Checkbox } from "@/shared/ui";
export function SpaceAppSelection({
  catalog,
  selected,
  onChange,
}: {
  catalog: OfficialApp[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id));
      return;
    }
    const result = new Set(selected);
    const add = (appId: string) => {
      if (result.has(appId)) return;
      result.add(appId);
      catalog.find((app) => app.id === appId)?.requires_apps?.forEach(add);
    };
    add(id);
    onChange([...result]);
  };
  const missing = selected.filter((id) => !catalog.some((app) => app.id === id));
  return (
    <section className="mt-4 space-y-2" aria-label="Space apps">
      <p className="text-sm font-medium">Apps for this Space</p>
      <p className="text-xs text-cream-muted">
        Everyone in the Space can use these tools. Personal accounts and device access stay
        personal.
      </p>
      {missing.map((id) => (
        <div key={id} className="flex items-center justify-between text-sm">
          <span>{id} is unavailable</span>
          <button type="button" onClick={() => toggle(id)}>
            Remove
          </button>
        </div>
      ))}
      <div className="max-h-64 overflow-y-auto divide-y divide-charcoal-border">
        {catalog.map((app) => (
          <div key={app.id} className="py-2">
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <Checkbox
                checked={selected.includes(app.id)}
                onCheckedChange={() => toggle(app.id)}
              />
              <span>{app.id === "chat" ? "Social" : app.name}</span>
            </label>
            {selected.includes(app.id) && (
              <details className="ml-7 mt-1 text-xs text-cream-muted">
                <summary className="cursor-pointer">App permissions</summary>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  {app.scopes.map((scope) => (
                    <li key={scope}>{appPermissionLabel(scope)}</li>
                  ))}
                </ul>
                {!!app.requires_apps?.length && (
                  <p className="mt-2">
                    Requires:{" "}
                    {app.requires_apps
                      .map((id) => catalog.find((item) => item.id === id)?.name ?? id)
                      .join(", ")}
                  </p>
                )}
              </details>
            )}
          </div>
        ))}
      </div>
      {!selected.length && (
        <p className="text-xs text-cream-muted">
          This Space will start with no apps. You can add them later.
        </p>
      )}
    </section>
  );
}
export function selectionComplete(catalog: OfficialApp[], ids: string[]) {
  return ids.every((id) => {
    const app = catalog.find((item) => item.id === id);
    return !!app && (app.requires_apps ?? []).every((required) => ids.includes(required));
  });
}
