// Adapted from Kura (MIT, Copyright (c) 2026 Kura contributors). See NOTICE.
import { memo, useMemo } from "react";
import { PropertyList, Text } from "@misty/ui";
import { ColumnsView } from "./ColumnsView";
import { FilePreview } from "./FilePreview";
import type { FilesSort } from "./files_choices";
import { formatBytes, formatDate, kindOf } from "./format";
import { ItemMenuFor } from "./ItemMenu";
import { samePlace, type FileItem } from "./model";
import { usePane } from "./pane_context";
import { useBrowser } from "./store/browser_store";

function ColumnPreview({ item }: { item: FileItem }) {
  return (
    <div className="flex w-60 shrink-0 flex-col gap-3 p-3">
      <div className="relative h-48 min-h-0 overflow-hidden">
        <FilePreview key={item.id} item={item} compact />
      </div>
      <Text weight="semibold" tone="bright" full>
        {item.name}
      </Text>
      <PropertyList
        label="Info"
        layout="stacked"
        items={[
          { label: "Kind", value: kindOf(item) },
          { label: "Size", value: formatBytes(item.size) },
          { label: "Modified", value: formatDate(item.modifiedMs) },
        ]}
      />
    </div>
  );
}

export const ColumnsArea = memo(function ColumnsArea({
  shown,
  hidden,
  sort,
}: {
  shown: Map<string, FileItem>;
  hidden: boolean;
  sort: FilesSort | undefined;
}) {
  const { store, actions } = usePane();
  const place = useBrowser((state) => state.place);
  const root = useBrowser((state) => state.columnRoot);
  const selected = useBrowser((state) => state.selected);
  const cut = useBrowser((state) => state.cut);
  const ids = useMemo(() => [...selected], [selected]);
  const one = ids.length === 1 ? shown.get(ids[0]) : undefined;
  return (
    <ColumnsView
      root={root}
      place={place}
      hidden={hidden}
      sort={sort}
      selected={ids}
      cut={cut}
      preview={one && !one.folder ? <ColumnPreview item={one} /> : undefined}
      onPick={(at, id, event, columnOrder) => {
        const state = store.getState();
        if (samePlace(at, state.place)) state.pick(id, columnOrder, event);
        else state.go(at, { replace: true, select: [id] });
      }}
      onOpen={actions.open}
      menu={(item) => <ItemMenuFor item={item} />}
      onDrop={actions.dropInto}
      onDwell={(at, item) => store.getState().go(at, { replace: true, select: [item.id] })}
    />
  );
});
