import { useSetupStore } from "./store/useSetupStore";
import { Badge, Select, SelectContent, SelectItem, SelectTrigger } from "@/shared/ui";
import { useShallow } from "zustand/react/shallow";

export function VersionPicker() {
  const { busy, releases, releasesLoading, selectedVersion, setSelectedVersion } = useSetupStore(
    useShallow((state) => ({
      busy: state.busy,
      releases: state.releases,
      releasesLoading: state.releasesLoading,
      selectedVersion: state.selectedVersion,
      setSelectedVersion: state.setSelectedVersion,
    })),
  );
  const latestVersion = releases[0]?.version ?? selectedVersion;
  const release = releases.find((entry) => entry.version === selectedVersion) ?? releases[0];

  return (
    <div className="relative w-full min-w-0">
      <Select
        disabled={busy || releasesLoading || releases.length === 0}
        value={release?.version ?? ""}
        onValueChange={setSelectedVersion}
      >
        <SelectTrigger aria-label="Runtime version" className="h-9">
          <span className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {release?.version ?? "Loading"}
            </span>
            <span className="min-w-0 truncate text-[11px] font-medium text-cream-muted">
              ·{" "}
              {releasesLoading
                ? "Fetching releases"
                : release?.version === latestVersion
                  ? "Latest release"
                  : release?.date}
            </span>
          </span>
        </SelectTrigger>
        <SelectContent className="min-w-[352px]">
          {releases.map((release) => (
            <SelectItem key={release.version} value={release.version}>
              <span className="inline-flex w-full min-w-0 items-center gap-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{release.version}</span>
                  <span className="block truncate text-xs text-cream-muted">{release.date}</span>
                </span>
                {release.version === latestVersion ? (
                  <Badge className="ml-auto" variant="secondary">
                    Latest
                  </Badge>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
