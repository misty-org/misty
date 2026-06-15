import {useAgentsAuth as useAuth,useAgentsAvatar as useAccountAvatarUrl} from "@/features/agents/agentsRuntime";

import {AgentsError as SystemErrorActivity} from "@/features/agents/agentsRuntime";

import { useLocalPinnedIds } from "@/shared/hooks/useLocalPinnedIds";
import { useMobileSurfaceChrome, useSurfacePresentation } from "@/shared/mobile";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  Input,
  Skeleton,
  cn,
} from "@/shared/ui";
import { ArrowRight, Pin, PinOff, Plus, RefreshCw, Search, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {runtimeAutomationsApi as automationsApi} from "@/features/agents/agentsRuntime";

import { AutomationIntegrationIcon } from "./AutomationIntegrationIcon";
import {
  normalizeAutomationStructure,
  type AutomationStructure,
} from "./normalizeAutomationStructure";
import type { AutomationFlow } from "./normalizeFlows";

export function AutomationListings(props: {
  flows: AutomationFlow[];
  connected: boolean | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onCreate: () => void;
  onOpen: (flow: AutomationFlow) => void;
}) {
  const presentation = useSurfacePresentation();
  const mobile = presentation !== "desktop";
  useMobileSurfaceChrome({ title: "Automations", level: "root" });
  const { user } = useAuth();
  const avatarUrl = useAccountAvatarUrl(user?.id, user?.avatarVersion);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? props.flows.filter((flow) =>
          `${flow.name} ${flow.trigger}`.toLowerCase().includes(normalized),
        )
      : props.flows;
  }, [props.flows, query]);
  const automationPinsKey = `misty:automation-pins:${user?.id ?? "anonymous"}`;
  const availableFlowIds = useMemo(() => props.flows.map((flow) => flow.id), [props.flows]);
  const { pinnedIdSet, togglePinned } = useLocalPinnedIds(
    automationPinsKey,
    availableFlowIds,
    props.loading,
  );
  const pinnedFlows = props.flows.filter((flow) => pinnedIdSet.has(flow.id));
  const recentFlows = props.flows.filter((flow) => !pinnedIdSet.has(flow.id));
  const [selectedId, setSelectedId] = useState("");
  const selected = filtered.find((flow) => flow.id === selectedId) ?? filtered[0];
  const [structure, setStructure] = useState<AutomationStructure | null>(null);

  useEffect(() => {
    if (!selected?.id) {
      setStructure(null);
      return;
    }
    let alive = true;
    void automationsApi.callTool("ap_flow_structure", { flowId: selected.id }).then(
      (result) => alive && setStructure(normalizeAutomationStructure(result.structured_content)),
      () => alive && setStructure(null),
    );
    return () => {
      alive = false;
    };
  }, [selected?.id]);

  return (
    <main
      className="flex h-full min-h-0 flex-col overflow-hidden bg-charcoal-bg text-cream"
      data-misty-automation-listings
    >
      {props.error ? (
        <SystemErrorActivity
          error={props.error}
          scope="automations:list"
          title="Automations could not be loaded"
        />
      ) : null}

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]",
          mobile ? "p-3" : "p-5",
        )}
      >
        <section className="flex min-h-0 flex-col">
          <div className={cn("mb-2 flex shrink-0 items-center gap-2", mobile ? "min-h-11" : "h-8")}>
            <h1 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
              My Automations
            </h1>
            <Button
              size={mobile ? "default" : "sm"}
              onClick={props.onCreate}
              disabled={props.loading || props.connected !== true}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              New
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-charcoal-border bg-charcoal-card">
            <div className="shrink-0 border-b border-charcoal-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-cream-muted" />
                <Input
                  className={cn("bg-charcoal-bg pl-9", mobile ? "h-11 text-base" : "h-8 text-xs")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search automations"
                  placeholder="Search automations"
                />
              </div>
            </div>
            <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto">
              {props.loading && !props.flows.length ? (
                <div className="space-y-px py-2">
                  {[0, 1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-14 rounded-none" />
                  ))}
                </div>
              ) : filtered.length ? (
                query.trim() ? (
                  <AutomationRows
                    flows={filtered}
                    selectedId={selected?.id}
                    pinnedIds={pinnedIdSet}
                    avatarUrl={avatarUrl}
                    creatorName={user?.name || "You"}
                    onSelect={setSelectedId}
                    onOpen={props.onOpen}
                    onTogglePin={togglePinned}
                    mobile={mobile}
                  />
                ) : (
                  <div className="pb-2">
                    <AutomationSection
                      title="Pinned"
                      flows={pinnedFlows}
                      emptyLabel="Pin an automation from its menu for quick access."
                      selectedId={selected?.id}
                      pinnedIds={pinnedIdSet}
                      avatarUrl={avatarUrl}
                      creatorName={user?.name || "You"}
                      onSelect={setSelectedId}
                      onOpen={props.onOpen}
                      onTogglePin={togglePinned}
                      mobile={mobile}
                    />
                    <AutomationSection
                      title="Recently edited"
                      flows={recentFlows}
                      emptyLabel="Your pinned automations are shown above."
                      selectedId={selected?.id}
                      pinnedIds={pinnedIdSet}
                      avatarUrl={avatarUrl}
                      creatorName={user?.name || "You"}
                      onSelect={setSelectedId}
                      onOpen={props.onOpen}
                      onTogglePin={togglePinned}
                      mobile={mobile}
                    />
                  </div>
                )
              ) : (
                <EmptyList
                  query={query}
                  connected={props.connected}
                  onCreate={props.onCreate}
                  onRetry={props.onRefresh}
                />
              )}
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col max-md:hidden">
          <div className="mb-2 flex h-8 shrink-0 items-center gap-2">
            <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-semibold text-cream-bright">
              {selected?.name ?? "Automation preview"}
            </h2>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={props.loading}
              onClick={props.onRefresh}
              aria-label="Refresh automations"
            >
              <RefreshCw className={cn("size-3.5", props.loading && "animate-spin")} />
            </Button>
            {selected ? (
              <Button size="sm" onClick={() => props.onOpen(selected)}>
                Open
                <ArrowRight data-icon="inline-end" className="size-3.5" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
          <div className="misty-scrollbar min-h-0 flex-1 overflow-y-auto rounded-2xl border border-charcoal-border bg-charcoal-card px-8 py-7">
            {selected ? (
              <div className="mx-auto max-w-[720px]">
                <div className="flex items-center gap-3">
                  <AutomationIntegrationIcon value={selected.trigger} framed />
                  <div className="min-w-0 flex-1 text-[11px] text-cream-muted">
                    <div className="flex items-center gap-2">
                      <CreatorAvatar url={avatarUrl} name={user?.name || "You"} />
                      <span>Created by {user?.name || "you"}</span>
                      <span>·</span>
                      <span>{structure?.steps.length ?? 0} steps</span>
                    </div>
                    <p className="mb-0 mt-1 truncate">{selected.trigger}</p>
                  </div>
                  <Badge variant={selected.status === "enabled" ? "secondary" : "outline"}>
                    {selected.status === "enabled" ? "On" : selected.published ? "Off" : "Draft"}
                  </Badge>
                </div>

                <div className="mt-8">
                  <div className="flex items-center gap-3">
                    <h3 className="m-0 text-xs font-semibold text-cream-bright">Workflow</h3>
                    <span className="text-[10px] text-cream-muted">
                      {selected.status === "enabled" ? "Runs when active" : "Not currently running"}
                    </span>
                  </div>
                  <div className="mt-3 border-y border-charcoal-border">
                    {(structure?.steps ?? []).map((step, index, rows) => (
                      <div key={step.name} className="relative flex items-center gap-3 px-2 py-3">
                        {index < rows.length - 1 ? (
                          <span
                            className="absolute bottom-[-9px] left-[25px] top-[38px] w-px bg-charcoal-border"
                            aria-hidden="true"
                          />
                        ) : null}
                        <AutomationIntegrationIcon
                          value={`${step.type} ${step.displayName}`}
                          framed
                        />
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-[12px] font-medium text-cream">
                            {step.displayName}
                          </p>
                          <p className="m-0 mt-0.5 truncate text-[10px] text-cream-muted">
                            {step.relationship === "trigger"
                              ? "Starts the automation"
                              : step.valid
                                ? "Configured"
                                : "Needs setup"}
                          </p>
                        </div>
                        <Badge variant={step.valid ? "outline" : "secondary"}>
                          {step.valid ? "Ready" : "Set up"}
                        </Badge>
                      </div>
                    ))}
                    {!structure?.steps.length ? (
                      <div className="flex min-h-44 flex-col items-center justify-center text-center">
                        <Workflow className="size-5 text-cream-muted" />
                        <p className="mb-0 mt-3 text-xs text-cream-muted">
                          Open this automation to choose a trigger and add steps.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-48 items-center justify-center text-xs text-cream-muted">
                Select an automation to preview its workflow.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

type AutomationRowsProps = {
  flows: AutomationFlow[];
  selectedId?: string;
  pinnedIds: Set<string>;
  avatarUrl: string;
  creatorName: string;
  onSelect: (flowId: string) => void;
  onOpen: (flow: AutomationFlow) => void;
  onTogglePin: (flowId: string) => void;
  mobile?: boolean;
};

function AutomationSection(props: AutomationRowsProps & { title: string; emptyLabel: string }) {
  return (
    <section aria-label={props.title}>
      <h2 className="m-0 px-3.5 pb-1.5 pt-3 text-xs font-semibold text-cream-muted">
        {props.title}
      </h2>
      {props.flows.length ? (
        <AutomationRows {...props} />
      ) : (
        <p className="px-3.5 py-2 text-[11px] leading-4 text-cream-muted/75">{props.emptyLabel}</p>
      )}
    </section>
  );
}

function AutomationRows(props: AutomationRowsProps) {
  return props.flows.map((flow) => {
    const selected = flow.id === props.selectedId;
    const pinned = props.pinnedIds.has(flow.id);
    return (
      <ContextMenu key={flow.id}>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group/automation flex min-h-14 w-full items-center gap-2.5 px-3.5 py-2 text-left outline-none transition-colors",
              selected
                ? "bg-charcoal-hover hover:bg-charcoal-hover"
                : "hover:bg-charcoal-border/65",
            )}
            aria-current={selected ? "true" : undefined}
            onClick={() => (props.mobile ? props.onOpen(flow) : props.onSelect(flow.id))}
            onDoubleClick={() => !props.mobile && props.onOpen(flow)}
          >
            <AutomationIntegrationIcon value={flow.trigger} framed />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-cream-bright">
                {flow.name}
              </span>
              <span className="mt-1 flex items-center gap-1.5 truncate text-[10px] text-cream-muted">
                <CreatorAvatar url={props.avatarUrl} name={props.creatorName} />
                {props.creatorName}
              </span>
            </span>
            {pinned ? (
              <Pin className="size-3 shrink-0 text-cream-muted" aria-hidden="true" />
            ) : null}
            <Badge variant={flow.status === "enabled" ? "secondary" : "outline"}>
              {flow.status === "enabled" ? "On" : flow.published ? "Off" : "Draft"}
            </Badge>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-40">
          <ContextMenuItem onSelect={() => props.onTogglePin(flow.id)}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  });
}

function CreatorAvatar(props: { url: string; name: string }) {
  return (
    <Avatar size="sm" className="size-4 border-0">
      <AvatarImage src={props.url} alt="" />
      <AvatarFallback className="text-[10px]">{initials(props.name)}</AvatarFallback>
    </Avatar>
  );
}

function EmptyList(props: {
  query: string;
  connected: boolean | null;
  onCreate: () => void;
  onRetry: () => void;
}) {
  const disconnected = props.connected === false;
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-8 text-center">
      <Workflow className="size-6 text-cream-muted" />
      <h3 className="mb-0 mt-4 text-sm font-semibold text-cream-bright">
        {props.query
          ? "No matching automations"
          : disconnected
            ? "Automation service unavailable"
            : "Create your first automation"}
      </h3>
      <p className="mb-5 mt-2 max-w-[36ch] text-xs leading-5 text-cream-muted">
        {props.query
          ? "Try a different name or integration."
          : disconnected
            ? "Misty could not start its built-in automation engine. Try again or check Activity."
            : "Connect your apps with a guided workflow that runs in your Misty server."}
      </p>
      {!props.query ? (
        <Button size="sm" onClick={disconnected ? props.onRetry : props.onCreate}>
          {disconnected ? <RefreshCw className="size-4" /> : <Plus className="size-4" />}
          {disconnected ? "Try again" : "New automation"}
        </Button>
      ) : null}
    </div>
  );
}

function initials(value: string) {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "Y"
  );
}
