import { useCallback, useEffect, useState } from "react";
import { EmptyState, SetupState } from "@misty/ui";
import { disk } from "@/features/files";
import { useSpacesStore } from "../list/useSpacesStore";
import { preferredDefaultSpace } from "../routes/defaultSpace";
import { FilesBrowser } from "./FilesBrowser";
import { messageOf } from "./format";
import type { FilesPlace } from "./model";

type Grant = { status: "checking" } | { status: "failed"; message: string } | { status: "off" | "on" | "declined" };

/**
 * The Files page (`/agents?view=files`), the same in every Space. Before anything shows it asks native
 * whether the disk grant is on; while it's off, a centered empty state asks to allow access, which only
 * the native prompt can give. Declined, Files stays on the Space drives and the person's projects.
 */
export function FilesPage() {
  const [grant, setGrant] = useState<Grant>({ status: "checking" });
  const [asking, setAsking] = useState(false);
  const spaces = useSpacesStore((state) => state.spaces);
  const personal = preferredDefaultSpace(spaces);

  const check = useCallback(() => {
    setGrant({ status: "checking" });
    void disk.granted().then(
      (on) => setGrant({ status: on ? "on" : "off" }),
      (cause) => setGrant({ status: "failed", message: messageOf(cause, "Misty couldn't check its access to your files.") }),
    );
  }, []);
  useEffect(check, [check]);

  const ask = () => {
    setAsking(true);
    void disk
      .grant()
      .then(
        (on) => setGrant({ status: on ? "on" : "declined" }),
        () => setGrant({ status: "declined" }),
      )
      .finally(() => setAsking(false));
  };

  if (grant.status === "checking" || grant.status === "failed")
    return (
      <SetupState
        tool="files"
        label="Checking access to your files"
        error={grant.status === "failed" ? grant.message : null}
        onRetry={check}
      />
    );
  if (grant.status === "off")
    return (
      <EmptyState
        title="Let Files open your disk"
        line="Misty asks your computer first. It never opens its own data, your keychains or system folders."
        action={{ label: "Allow access", onClick: ask, disabled: asking }}
      />
    );
  const granted = grant.status === "on";
  const start: FilesPlace | undefined = granted
    ? { kind: "recent" }
    : personal
      ? { kind: "space-drive", spaceId: personal.id, path: "/" }
      : undefined;
  if (!start) return <EmptyState title="No places to open" line="Join or make a Space, or add a project, to see its files here." />;
  return <FilesBrowser granted={granted} start={start} />;
}
