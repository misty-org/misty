import {
  Button,
  CollectionFilters,
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  type CollectionColumn,
  type CollectionItem,
} from "@/shared/ui";
import { FileText, Image, Pause, X } from "lucide-react";
import { devices } from "../../data/project";
import type { FilesState } from "../../film/state";

type Row = { name: string; progress: number; source: string; destination: string; time: string };

/** Mirrors TransfersPage's TransferProgress: bar plus percentage while running. */
function Progress({ row }: { row: Row }) {
  if (row.progress >= 1) return <span className="text-xs">Completed</span>;
  const percent = Math.round(row.progress * 100);
  return (
    <div className="flex w-32 items-center gap-3" data-t="transfer-progress">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-charcoal-border">
        <div className="h-full rounded-full bg-cream-muted" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-cream">{percent}%</span>
    </div>
  );
}

export function TransfersView({ state }: { state: FilesState }) {
  const rows: Row[] = [
    {
      name: "hero-photo.jpg",
      progress: state.transfer ?? 0,
      source: `${devices.studio}/Website launch/hero-photo.jpg`,
      destination: "~/Documents/Website launch",
      time: "Today, 9:52 AM",
    },
    {
      name: "Brand guidelines.pdf",
      progress: 1,
      source: "~/Downloads/Brand guidelines.pdf",
      destination: "~/Documents/Website launch",
      time: "Yesterday, 4:10 PM",
    },
  ];
  const lookup = new Map(rows.map((row) => [row.name, row]));
  const text = (value: string) => <span className="block max-w-56 truncate text-xs">{value}</span>;
  const columns: CollectionColumn[] = [
    { key: "status", label: "Status", render: (item) => <Progress row={lookup.get(item.id)!} />, sortValue: () => 0 },
    { key: "operation", label: "Operation", render: () => "Copy", sortValue: () => 0 },
    { key: "source", label: "Source", render: (item) => text(lookup.get(item.id)!.source), sortValue: () => 0 },
    { key: "destination", label: "Destination", render: (item) => text(lookup.get(item.id)!.destination), sortValue: () => 0 },
    { key: "updated", label: "Time", render: (item) => <span className="text-xs tabular-nums">{item.updated}</span>, sortValue: () => 0 },
  ];
  const items: CollectionItem[] = rows.map((row) => ({
    id: row.name,
    title: row.name,
    icon: row.name.endsWith(".jpg") ? <Image size={18} /> : <FileText size={18} />,
    category: "Copy",
    updated: row.time,
    onOpen: () => {},
    actions:
      row.progress < 1 ? (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm">
            <Pause size={15} /> Pause
          </Button>
          <Button variant="ghost" size="sm">
            <X size={15} /> Cancel
          </Button>
        </div>
      ) : undefined,
  }));
  return (
    <CollectionPage className="px-8 pt-4">
      <CollectionHeading title="Transfers" actions={<CollectionSearch placeholder="Search transfers" readOnly />} />
      <CollectionFilters
        options={["All", "Active", "Failed", "Completed"].map((label) => ({ value: label, label }))}
        value="All"
        onChange={() => {}}
        actions={<Button variant="outline">Pause queue</Button>}
      />
      <CollectionItems items={items} columns={columns} stickyActions />
    </CollectionPage>
  );
}
