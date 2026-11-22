import { useCallback, useEffect, useState } from "react";
import { ErrorState, notify } from "@misty/ui";
import { disk, type ThumbnailCacheStatus } from "@/features/files";
import {
  DesktopSettingsRow as SettingsRow,
  DesktopSettingsSection as SettingsSectionBlock,
  type SettingsContentProps,
} from "@/features/settings";
import { DesktopSettingsRowSkeleton } from "@/features/settings/components/DesktopSettingsUI";
import { DropdownControl } from "@/features/settings/SettingsControls";
import { formatBytes } from "./format";

const MB = 1024 * 1024;
const choices = [128, 256, 512, 1024, 2048].map((mb) => ({
  value: String(mb * MB),
  label: mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`,
}));

type Loaded = { status: "loading" } | { status: "failed" } | { status: "ready"; cache: ThumbnailCacheStatus };

/**
 * Settings › Files › Thumbnails: how much room the grid's thumbnails may take on this computer.
 * Native code keeps the limit and removes the thumbnails used longest ago once it is passed.
 */
export function FilesSettingsSection(props: SettingsContentProps) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const load = useCallback(() => {
    setLoaded({ status: "loading" });
    disk.thumbnailCache().then(
      (cache) => setLoaded({ status: "ready", cache }),
      () => setLoaded({ status: "failed" }),
    );
  }, []);
  useEffect(load, [load]);

  let row;
  if (loaded.status === "loading")
    row = <DesktopSettingsRowSkeleton label="Thumbnail cache" description control="select" />;
  else if (loaded.status === "failed")
    row = (
      <ErrorState
        inline
        title="The thumbnail cache couldn't be read"
        line="Its size and limit aren't known right now."
        action={{ label: "Try again", onClick: load }}
      />
    );
  else {
    const { cache } = loaded;
    // A limit set some other way still shows as itself.
    const options = choices.some((choice) => choice.value === String(cache.limit))
      ? choices
      : [...choices, { value: String(cache.limit), label: formatBytes(cache.limit) }];
    row = (
      <SettingsRow label="Keep up to" description={`${formatBytes(cache.used)} of thumbnails on this computer now.`}>
        <DropdownControl
          value={String(cache.limit)}
          options={options}
          disabled={props.working}
          onValueChange={(value) =>
            disk.setThumbnailCacheLimit(Number(value)).then(
              (next) => setLoaded({ status: "ready", cache: next }),
              () => notify({ message: "The thumbnail limit couldn't be changed. Try again.", tone: "error" }),
            )
          }
        />
      </SettingsRow>
    );
  }
  return <SettingsSectionBlock title="Thumbnails">{row}</SettingsSectionBlock>;
}
