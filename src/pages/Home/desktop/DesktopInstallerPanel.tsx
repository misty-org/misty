import { InstallerCard } from "../../../components/installer/InstallerCard";

export function DesktopInstallerPanel() {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0d10]/95 p-4 shadow-2xl shadow-black/25 xl:col-span-4 xl:col-start-1 xl:row-span-3 xl:row-start-1">
      <InstallerCard className="min-h-0 flex-1" embedded />
    </div>
  );
}
