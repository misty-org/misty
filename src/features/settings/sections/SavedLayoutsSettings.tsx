import { useDockingLayoutStore, type DockingLayout } from "@/features/app-shell/dockingLayout";
import { useWindowDockingLayout, useWorkspaceStore } from "@/features/workspace";
import { Button, Input } from "@/shared/ui";
import { useState } from "react";
import { DesktopSettingsRow, DesktopSettingsSection } from "../components/DesktopSettingsUI";
import { useSettingsProfiles } from "../profiles/store";

const describe = (layout: DockingLayout) => `Navigation ${layout.navigation} · Tabs ${layout.tabs}`;

/** Named navigation and tab positions, saved to the account and applied to the current window. */
export function SavedLayoutsSettings() {
  const current = useWindowDockingLayout();
  const setLayout = useWorkspaceStore((state) => state.setWindowDockingLayout);
  const saved = useDockingLayoutStore((state) => state.savedLayouts);
  const saveLayout = useDockingLayoutStore((state) => state.saveLayout);
  const removeLayout = useDockingLayoutStore((state) => state.removeLayout);
  const ready = useSettingsProfiles((store) => store.ready);
  const [name, setName] = useState("");
  const [failure, setFailure] = useState("");
  const run = (action: Promise<unknown>, message: string) => {
    setFailure("");
    void action.catch(() => setFailure(message));
  };
  const save = () => {
    if (!name.trim()) return;
    run(
      saveLayout(name, current).then(() => setName("")),
      "Couldn't save this layout. Try again.",
    );
  };
  return (
    <DesktopSettingsSection
      title="Saved layouts"
      description="Save this window's navigation and tab positions to reuse them in any window."
    >
      <DesktopSettingsRow label="Save current layout" description={describe(current)}>
        <form
          className="flex w-full min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Input
            aria-label="Layout name"
            placeholder="Focus"
            maxLength={40}
            value={name}
            disabled={!ready}
            className="min-w-0 flex-1"
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={!ready || !name.trim()}>
            Save
          </Button>
        </form>
      </DesktopSettingsRow>
      {saved.map((layout) => (
        <DesktopSettingsRow key={layout.id} label={layout.name} description={describe(layout)}>
          <Button
            variant="outline"
            size="sm"
            disabled={layout.navigation === current.navigation && layout.tabs === current.tabs}
            onClick={() => setLayout({ navigation: layout.navigation, tabs: layout.tabs })}
          >
            Apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${layout.name}`}
            disabled={!ready}
            onClick={() =>
              run(removeLayout(layout.id), `Couldn't delete “${layout.name}”. Try again.`)
            }
          >
            Delete
          </Button>
        </DesktopSettingsRow>
      ))}
      {failure ? (
        <p role="alert" className="border-t border-charcoal-border py-3 text-sm text-cream">
          {failure}
        </p>
      ) : null}
    </DesktopSettingsSection>
  );
}
