import { Bell, Cloud, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import petIdle from "../../../assets/pets/cloud-folder/idle.png";
import { canUseCloudFolderPetOverlay, closeCloudFolderPetWindow, openCloudFolderPetWindow } from "../../../pets/cloudFolderPet";
import { selectPetPreferences, useSettingsStore } from "../../../stores/useSettingsStore";
import { useExplorerStore } from "../../../stores/useExplorerStore";
import { useAppStore } from "../../../stores/useAppStore";

const panelClass =
  "grid min-w-0 overflow-hidden rounded-2xl border border-white/[0.08] bg-[var(--misty-app-panel-bg,var(--misty-app-page-bg,var(--misty-bg)))] p-3 shadow-xl shadow-black/20";
const actionButtonClass =
  "inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] p-0 text-text-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-text disabled:opacity-50";
const toggleBaseClass =
  "relative h-6 w-11 rounded-full border p-0 transition";

export function DesktopPetPanel() {
  const overlayAvailable = canUseCloudFolderPetOverlay();
  const assetsDir = useAppStore((state) => state.app?.environment.assetsDir);
  const pushNotification = useExplorerStore((state) => state.pushNotification);
  const { enabled, updateSetting } = useSettingsStore(
    useShallow((state) => ({
      enabled: selectPetPreferences(state.settings?.document).cloudFolderEnabled,
      updateSetting: state.updateSetting,
    })),
  );

  const setEnabled = (nextEnabled: boolean) => {
    updateSetting("pets", "cloud_folder_enabled", nextEnabled);
    if (nextEnabled) void openCloudFolderPetWindow(assetsDir);
    else void closeCloudFolderPetWindow();
  };

  const sendTestNotification = () => {
    if (!enabled) {
      setEnabled(true);
      window.setTimeout(() => {
        pushNotification("Cloud pet is listening for Misty notifications.", "success", 3500);
      }, 350);
      return;
    }
    pushNotification("Cloud pet is listening for Misty notifications.", "success", 3500);
  };

  return (
    <section className={panelClass} aria-label="Desktop pet">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2 border-b border-white/[0.06] pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-text-muted">
            <Cloud className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 truncate text-sm font-bold text-text">Desktop pet</h2>
            <p className="m-0 mt-0.5 truncate text-[11px] text-text-muted">
              {overlayAvailable ? (enabled ? "Cloud folder is on" : "Cloud folder is resting") : "Desktop app required"}
            </p>
          </div>
        </div>
        <button
          aria-label={enabled ? "Disable cloud folder pet" : "Enable cloud folder pet"}
          aria-pressed={enabled}
          className={`${toggleBaseClass} ${enabled ? "border-[#67e8f9]/40 bg-[#0891b2]" : "border-white/10 bg-white/[0.06]"}`}
          disabled={!overlayAvailable}
          onClick={() => setEnabled(!enabled)}
          title={enabled ? "Disable cloud folder pet" : "Enable cloud folder pet"}
          type="button"
        >
          <span
            className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${enabled ? "left-[22px]" : "left-1"}`}
          />
        </button>
      </div>

      <div className="grid min-w-0 grid-cols-[74px_minmax(0,1fr)] items-center gap-3">
        <div className="grid h-[74px] place-items-center overflow-hidden rounded-xl bg-white/[0.035]">
          <img
            alt=""
            className="h-[70px] w-[86px] object-contain"
            draggable={false}
            src={petIdle}
          />
        </div>
        <div className="min-w-0">
          <p className="m-0 line-clamp-2 text-xs leading-5 text-text-muted">
            A tiny transparent companion for transfer updates and Misty notifications.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              className={actionButtonClass}
              disabled={!overlayAvailable}
              onClick={sendTestNotification}
              title="Send test notification"
              type="button"
            >
              <Bell className="h-4 w-4" />
            </button>
            {enabled ? (
              <button
                className={actionButtonClass}
                onClick={() => setEnabled(false)}
                title="Hide pet"
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
