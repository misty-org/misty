import { Download, FolderOpen } from "lucide-react";
import { useEffect } from "react";
import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  ListRowSkeleton,
  MenuItem,
  Popover,
  PopoverActions,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  RingMeter,
  RowGroup,
} from "@misty/ui";
import {
  clearDownloads,
  downloadsRunning,
  followWebDownloads,
  loadWebDownloads,
  openDownload,
  useWebDownloads,
  type WebDownload,
} from "./web_downloads";

function where(item: WebDownload, spaceName: (id: string) => string) {
  if (item.state === "failed") return item.error || "Failed";
  if (item.state === "interrupted") return "Stopped when Misty quit";
  if (item.state === "finished" && !item.exists) return "Moved or deleted";
  return item.spaceId ? `${spaceName(item.spaceId)} › Downloads` : "Downloads on this computer";
}

export function WebDownloadsButton(props: {
  spaceName(id: string): string;
  onShowFiles(spaceId: string): void;
}) {
  const { items, loaded, failed } = useWebDownloads();
  const running = downloadsRunning(items);
  useEffect(() => followWebDownloads(), []);
  const recent = items.slice(0, 8);
  const lastSpace = recent.find((item) => item.spaceId)?.spaceId ?? "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={running ? `Downloads, ${running} in progress` : "Downloads"}>
          {running ? <RingMeter /> : <Download />}
        </IconButton>
      </PopoverTrigger>
      <PopoverContent kind="panel" size="lg" align="end">
        <PopoverHeader title="Downloads" close />
        <PopoverBody>
          {!loaded ? (
            <ListRowSkeleton label="Downloads" rows={3} lines={2} state />
          ) : failed ? (
            <ErrorState
              inline
              title="Downloads couldn't load"
              action={{ label: "Try again", variant: "secondary", onClick: () => void loadWebDownloads() }}
            />
          ) : !recent.length ? (
            <EmptyState inline title="No downloads yet" />
          ) : (
            <RowGroup>
              {recent.map((item) => (
                <ListRow
                  key={item.id}
                  label={item.fileName || item.url}
                  description={where(item, props.spaceName)}
                  state={
                    item.state === "in_progress"
                      ? { kind: "working", label: "Downloading" }
                      : item.state === "failed"
                        ? { kind: "failed" }
                        : { kind: "time", at: item.finishedAt ?? item.startedAt }
                  }
                  disabled={item.state !== "finished" || !item.exists}
                  onOpen={() => void openDownload(item.id).catch(() => undefined)}
                  menu={
                    item.spaceId && item.exists ? (
                      <MenuItem
                        icon={FolderOpen}
                        label="Show in Files"
                        onSelect={() => props.onShowFiles(item.spaceId)}
                      />
                    ) : undefined
                  }
                />
              ))}
            </RowGroup>
          )}
        </PopoverBody>
        {recent.length ? (
          <PopoverActions>
            <Button variant="quiet" onClick={() => void clearDownloads()}>
              Clear list
            </Button>
            {lastSpace ? (
              <Button onClick={() => props.onShowFiles(lastSpace)}>Show in Files</Button>
            ) : null}
          </PopoverActions>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
