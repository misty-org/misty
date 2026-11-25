// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { CircleSlash, Eraser, Pause, Play, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CollectionFilterMenu,
  CollectionHeading,
  CollectionItems,
  CollectionPage,
  CollectionSearch,
  EmptyState,
  IconButton,
  MenuItem,
  Progress,
  StateMark,
  Text,
  type CollectionColumn,
  type CollectionItem,
} from "@misty/ui";
import { formatBytes, formatDate } from "./format";
import { nameOf } from "./model";
import { canStop, cancelTransfer, useTransfers, type Transfer } from "./transfers";

const states = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const stateWords: Record<Transfer["state"], string> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function TransferState({ transfer }: { transfer: Transfer }) {
  if (transfer.state === "running") {
    const share =
      transfer.totalBytes > 0 ? Math.min(100, (transfer.doneBytes / transfer.totalBytes) * 100) : 0;
    return (
      <span className="flex w-40 items-center gap-2">
        <Progress value={share} aria-label={transfer.label} className="flex-1" />
        <Text size="meta" tone="muted">
          {`${Math.round(share)}%`}
        </Text>
      </span>
    );
  }
  if (transfer.state === "queued")
    return (
      <Text size="meta" tone="muted">
        Queued
      </Text>
    );
  if (transfer.state === "done") return <StateMark kind="done" />;
  if (transfer.state === "failed") return <StateMark kind="failed" />;
  return (
    <Text size="meta" tone="muted">
      Cancelled
    </Text>
  );
}

function transferMenu(transfer: Transfer) {
  if (canStop(transfer))
    return (
      <MenuItem icon={CircleSlash} label="Cancel" onSelect={() => cancelTransfer(transfer.opId)} />
    );
  if (transfer.retry && transfer.state !== "done")
    return <MenuItem icon={RotateCcw} label="Try again" onSelect={transfer.retry} />;
  return undefined;
}

export function TransfersView({ onClose }: { onClose(): void }) {
  const byOpId = useTransfers((store) => store.byId);
  const order = useTransfers((store) => store.order);
  const list = useMemo(() => order.flatMap((id) => byOpId[id] ?? []), [order, byOpId]);
  const clearFinished = useTransfers((store) => store.clearFinished);
  const paused = useTransfers((store) => store.paused);
  const setPaused = useTransfers((store) => store.setPaused);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<string>("all");
  const needle = query.trim().toLocaleLowerCase();
  const shown = list.filter(
    (each) =>
      (state === "all" || each.state === state) &&
      (!needle || each.label.toLocaleLowerCase().includes(needle)),
  );
  const byId = new Map(shown.map((each) => [each.opId, each]));

  const columns: CollectionColumn[] = [
    {
      key: "status",
      label: "Status",
      render: (item) => {
        const transfer = byId.get(item.id);
        return transfer ? <TransferState transfer={transfer} /> : null;
      },
      sortValue: (item) => byId.get(item.id)?.state,
    },
    ...(["from", "to"] as const).map<CollectionColumn>((side) => ({
      key: side,
      label: side === "from" ? "Source" : "Destination",
      render: (item) => {
        const path = byId.get(item.id)?.[side];
        return path ? (
          <Text size="meta" tone="muted" full={path}>
            {nameOf(path) || path}
          </Text>
        ) : (
          "—"
        );
      },
      sortValue: (item) => byId.get(item.id)?.[side],
    })),
    {
      key: "size",
      label: "Size",
      render: (item) => String(item.metadata?.Size ?? "—"),
      sortValue: (item) => byId.get(item.id)?.totalBytes,
    },
    {
      key: "time",
      label: "Time",
      render: (item) => item.updated,
      sortValue: (item) => byId.get(item.id)?.queuedAt,
    },
  ];
  const items: CollectionItem[] = shown.map((transfer) => ({
    id: transfer.opId,
    title: transfer.error
      ? `${transfer.label}: ${transfer.error}`
      : transfer.item
        ? `${transfer.label} ${transfer.item}`
        : transfer.label,
    category: stateWords[transfer.state],
    updated: formatDate(transfer.endedAt ?? transfer.startedAt ?? transfer.queuedAt),
    metadata: { Size: transfer.totalBytes > 0 ? formatBytes(transfer.totalBytes) : "—" },
    menu: transferMenu(transfer),
    menuLabel: `Actions for ${transfer.label}`,
    onOpen: () => undefined,
  }));
  const finished = list.some((each) => each.state !== "running" && each.state !== "queued");
  const waiting = list.some((each) => each.state === "running" || each.state === "queued");

  return (
    <CollectionPage>
      <CollectionHeading
        title="Transfers"
        actionsLabel="Transfers"
        actions={[
          ...(paused || waiting
            ? [
                paused
                  ? {
                      id: "queue",
                      icon: Play,
                      label: "Resume queue",
                      priority: 2,
                      onSelect: () => setPaused(false),
                    }
                  : {
                      id: "queue",
                      icon: Pause,
                      label: "Pause queue",
                      priority: 2,
                      onSelect: () => setPaused(true),
                    },
              ]
            : []),
          ...(finished
            ? [
                {
                  id: "clear",
                  icon: Eraser,
                  label: "Clear finished",
                  priority: 1,
                  onSelect: clearFinished,
                },
              ]
            : []),
        ]}
        end={
          <>
            <CollectionFilterMenu
              label="Filter transfers"
              active={state !== "all"}
              onReset={() => setState("all")}
              groups={[{ label: "State", value: state, options: [...states], onChange: setState }]}
            />
            <CollectionSearch
              aria-label="Search transfers"
              placeholder="Search transfers"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClear={() => setQuery("")}
            />
            <IconButton label="Close" onClick={onClose}>
              <X />
            </IconButton>
          </>
        }
      />
      {items.length ? (
        <CollectionItems
          view="list"
          columns={columns}
          columnSetId="files-transfers"
          items={items}
        />
      ) : (
        <EmptyState
          title={list.length ? "No transfers match" : "No transfers yet"}
          line={
            list.length
              ? "Try another search or filter."
              : "Copies, moves and other long operations show up here."
          }
        />
      )}
    </CollectionPage>
  );
}
