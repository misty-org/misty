import { Button } from "./button";
import { PermissionState } from "./state-view";
import { cn } from "./utils";

export const mistyDownloadUrl = "https://mistysys.com/download";

export function DesktopAccessState(props: { feature: string; className?: string }) {
  return (
    <PermissionState
      className={cn("h-full", props.className)}
      title={`${props.feature} requires the Misty desktop app`}
      description={`${props.feature} needs access to your device or operating system and isn’t available in a web browser. Download Misty for full access.`}
      action={
        <Button asChild>
          <a href={mistyDownloadUrl} rel="noreferrer" target="_blank">
            Download for full access
          </a>
        </Button>
      }
    />
  );
}
