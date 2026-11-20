import { useAuth } from "@/features/account";
import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  SkeletonList,
  useNotice,
} from "@misty/ui";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { setItemVisibility, type ItemVisibility } from "../api/visibility";
import {
  listEmbedParts,
  listEmbedSources,
  type EmbedPart,
  type EmbedSourceItem,
} from "./embedSources";
import { embedKinds, type EmbedKind, type EmbedReference } from "./embedTypes";
import { embedAllowance, type EmbedAllowance } from "./embedVisibility";

export interface EmbedPickerProps {
  spaceId: string;
  /** The doc's or deck's own layer, which decides what may go in. */
  hostVisibility: ItemVisibility;
  /** Who made the host; a private host is its viewer's own, the default. */
  hostCreatorId?: string;
  /** Which parts to offer; all three by default. */
  kinds?: readonly EmbedKind[];
  onPick(embed: EmbedReference): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  /**
   * What the picker opens from: a button that forwards its ref (a trigger), or with `anchored`
   * any element it only sits beside (the slash menu's caret).
   */
  children: ReactElement;
  anchored?: boolean;
}

type Loaded<T> = { phase: "loading" } | { phase: "failed" } | { phase: "ready"; value: T };

const partGroups: Array<{ kind: EmbedKind; heading: string }> = [
  { kind: "data-chart", heading: "Charts" },
  { kind: "data-range", heading: "Ranges" },
  { kind: "board-frame", heading: "Frames" },
];

/** The Space's items that hold embeddable parts, read while the picker is open. */
function useEmbedSources(spaceId: string, kinds: readonly EmbedKind[], open: boolean) {
  const [sources, setSources] = useState<Loaded<EmbedSourceItem[]>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const kindKey = kinds.join(",");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setSources({ phase: "loading" });
    listEmbedSources(spaceId, kindKey.split(",") as EmbedKind[])
      .then((value) => {
        if (active) setSources({ phase: "ready", value });
      })
      .catch(() => {
        if (active) setSources({ phase: "failed" });
      });
    return () => {
      active = false;
    };
  }, [spaceId, kindKey, open, attempt]);
  return { sources, setSources, retry: () => setAttempt((value) => value + 1) };
}

/** One source's parts, read from its room once it is chosen. */
function useEmbedParts(
  spaceId: string,
  source: EmbedSourceItem | null,
  kinds: readonly EmbedKind[],
) {
  const [parts, setParts] = useState<Loaded<EmbedPart[]>>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const sourceKind = source?.kind;
  const sourceId = source?.id;
  const kindKey = kinds.join(",");
  useEffect(() => {
    if (!sourceKind || !sourceId) return;
    let active = true;
    setParts({ phase: "loading" });
    listEmbedParts(spaceId, { kind: sourceKind, id: sourceId }, kindKey.split(",") as EmbedKind[])
      .then((value) => {
        if (active) setParts({ phase: "ready", value });
      })
      .catch(() => {
        if (active) setParts({ phase: "failed" });
      });
    return () => {
      active = false;
    };
  }, [spaceId, sourceKind, sourceId, kindKey, attempt]);
  return { parts, retry: () => setAttempt((value) => value + 1) };
}

/**
 * Picks a Data chart, a Data range or a Whiteboard frame from the Space to embed: first the item,
 * then its part. What the host may not take is shown but can't be inserted; the person's own
 * private item in a shared host offers "Make shared", and goes in once it is shared.
 */
export function EmbedPicker(props: EmbedPickerProps) {
  const { user } = useAuth();
  const kinds = props.kinds?.length ? props.kinds : embedKinds;
  const {
    sources,
    setSources,
    retry: retrySources,
  } = useEmbedSources(props.spaceId, kinds, props.open);
  const [chosen, setChosen] = useState<EmbedSourceItem | null>(null);
  const { parts, retry: retryParts } = useEmbedParts(props.spaceId, chosen, kinds);
  const [search, setSearch] = useState("");
  const [sharing, setSharing] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  useEffect(() => {
    if (props.open) return;
    setChosen(null);
    setSearch("");
    setSharing(false);
    setShareFailed(false);
  }, [props.open]);

  useNotice(shareFailed, {
    message: "The item couldn’t be shared. Try again.",
    tone: "error",
    onDismiss: () => setShareFailed(false),
  });

  const host = { visibility: props.hostVisibility, creatorId: props.hostCreatorId };
  const allowanceFor = (source: EmbedSourceItem): EmbedAllowance =>
    embedAllowance(host, source, user?.id);

  const insert = (source: EmbedSourceItem, part: EmbedPart) => {
    props.onPick({ kind: part.kind, item_id: source.id, part_id: part.partId, title: part.title });
    props.onOpenChange(false);
  };

  const shareThenInsert = async (source: EmbedSourceItem, part: EmbedPart) => {
    if (sharing) return;
    setSharing(true);
    setShareFailed(false);
    try {
      await setItemVisibility(props.spaceId, source.kind, source.id, "public");
      const shared = { ...source, visibility: "public" as const };
      setChosen(shared);
      setSources((current) =>
        current.phase === "ready"
          ? {
              phase: "ready",
              value: current.value.map((entry) => (entry.id === source.id ? shared : entry)),
            }
          : current,
      );
      insert(shared, part);
    } catch {
      setShareFailed(true);
    } finally {
      setSharing(false);
    }
  };

  const pickPart = (source: EmbedSourceItem, part: EmbedPart) => {
    const allowance = allowanceFor(source);
    if (allowance.ok) insert(source, part);
    else if (allowance.fix === "make-shared") void shareThenInsert(source, part);
  };

  const anchor = props.anchored ? (
    <PopoverAnchor asChild>{props.children}</PopoverAnchor>
  ) : (
    <PopoverTrigger asChild>{props.children}</PopoverTrigger>
  );

  let rows: ReactElement;
  if (!chosen) {
    if (sources.phase === "loading") {
      rows = <SkeletonList label="Items" rows={4} className="p-1" rowClassName="gap-2 px-2" />;
    } else if (sources.phase === "failed") {
      rows = (
        <CommandGroup>
          <CommandItem
            value="retry"
            label="Items couldn’t load. Try again"
            onSelect={retrySources}
          />
        </CommandGroup>
      );
    } else {
      const data = sources.value.filter((source) => source.kind === "workbook");
      const boards = sources.value.filter((source) => source.kind === "drawing");
      rows = (
        <>
          <CommandEmpty>No items match</CommandEmpty>
          {[
            { heading: "Data", items: data },
            { heading: "Whiteboards", items: boards },
          ].map((group) =>
            group.items.length ? (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((source) => (
                  <CommandItem
                    key={`${source.kind}:${source.id}`}
                    value={`${source.kind}:${source.id}`}
                    keywords={[source.title]}
                    label={source.title}
                    shortcut={source.visibility === "private" ? "Private" : undefined}
                    onSelect={() => {
                      setSearch("");
                      setChosen(source);
                    }}
                  />
                ))}
              </CommandGroup>
            ) : null,
          )}
        </>
      );
    }
  } else {
    const allowance = allowanceFor(chosen);
    const back = (
      <CommandGroup>
        <CommandItem
          value="back"
          icon={ChevronLeft}
          label={chosen.title}
          onSelect={() => {
            setSearch("");
            setChosen(null);
          }}
        />
      </CommandGroup>
    );
    let partRows: ReactElement;
    if (parts.phase === "loading") {
      partRows = <SkeletonList label="Parts" rows={3} className="p-1" rowClassName="gap-2 px-2" />;
    } else if (parts.phase === "failed") {
      partRows = (
        <CommandGroup>
          <CommandItem value="retry" label="Parts couldn’t load. Try again" onSelect={retryParts} />
        </CommandGroup>
      );
    } else {
      partRows = (
        <>
          <CommandEmpty>
            {parts.value.length ? "No parts match" : "Nothing in it can be embedded yet"}
          </CommandEmpty>
          {partGroups.map((group) => {
            const items = parts.value.filter((part) => part.kind === group.kind);
            if (!items.length) return null;
            return (
              <CommandGroup key={group.kind} heading={group.heading}>
                {items.map((part) => (
                  <CommandItem
                    key={part.partId}
                    value={`${part.kind}:${part.partId}`}
                    keywords={[part.title]}
                    label={part.title}
                    disabled={sharing || (!allowance.ok && allowance.fix === null)}
                    reason={!allowance.ok && allowance.fix === null ? allowance.reason : undefined}
                    end={
                      !allowance.ok && allowance.fix === "make-shared" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={sharing}
                          onClick={() => void shareThenInsert(chosen, part)}
                        >
                          Make shared
                        </Button>
                      ) : undefined
                    }
                    onSelect={() => pickPart(chosen, part)}
                  />
                ))}
              </CommandGroup>
            );
          })}
        </>
      );
    }
    rows = (
      <>
        {back}
        <CommandSeparator />
        {partRows}
      </>
    );
  }

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      {anchor}
      <PopoverContent kind="flush" size="lg" align="start">
        <Command label="Embed">
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={chosen ? "Search parts" : "Search items"}
            aria-label={chosen ? "Search parts" : "Search items"}
          />
          <CommandList>{rows}</CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
