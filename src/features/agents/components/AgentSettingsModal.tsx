import { CompanionAppearanceSettings } from "../companion/CompanionAppearanceSettings";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";
import { Cable, Plus, SlidersHorizontal } from "lucide-react";
import { McpConnectionsView } from "../mcp/McpConnectionsSheet";

export type AgentSettingsTab = "settings" | "connections";

export function AgentSettingsModal(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  activeTab: AgentSettingsTab;
  onTabChange(tab: AgentSettingsTab): void;
  title?: string;
  mode?: "edit" | "create";
  container?: HTMLElement | null;
  disabled?: boolean;
  onCreateAgent?(): void;
  onNewConversation?(): void;
  children?: React.ReactNode;
}) {
  const isCreate = props.mode === "create";

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        container={props.container}
        className="flex max-h-[85%] w-[min(680px,94%)] sm:max-w-[680px] flex-col overflow-hidden rounded-xl border border-charcoal-border/80 bg-charcoal-card p-0 shadow-2xl"
        aria-describedby="agent-settings-dialog-description"
      >
        <DialogHeaderWithTabs
          title={props.title ?? (isCreate ? "Create new agent" : "Agent settings")}
          activeTab={props.activeTab}
          onTabChange={props.onTabChange}
          showTabs={!isCreate}
          onCreateAgent={props.onCreateAgent}
          onNewConversation={props.onNewConversation}
        />
        <DialogDescription id="agent-settings-dialog-description" className="sr-only">
          {isCreate
            ? "Configure and create a new personal agent."
            : "Manage agent profile settings, instructions, and MCP tool connections."}
        </DialogDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 misty-transient-scrollbar">
          {props.activeTab === "settings" && (
            <div className="space-y-6">
              {!isCreate && <CompanionAppearanceSettings />}
              {props.children}
            </div>
          )}

          {props.activeTab === "connections" && !isCreate && (
            <div className="space-y-6">
              <McpConnectionsView />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DialogHeaderWithTabs(props: {
  title?: string;
  activeTab: AgentSettingsTab;
  onTabChange(tab: AgentSettingsTab): void;
  showTabs?: boolean;
  onCreateAgent?(): void;
  onNewConversation?(): void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-charcoal-border px-6 pt-4 pb-3 pr-14">
      <DialogTitle className="m-0 text-base font-semibold text-cream-bright">
        {props.title || "Agent settings"}
      </DialogTitle>

      <div className="flex items-center gap-2">
        {props.showTabs !== false && (
          <Tabs
            value={props.activeTab}
            onValueChange={(tab) => props.onTabChange(tab as AgentSettingsTab)}
          >
            <TabsList aria-label="Agent settings tabs" className="h-8">
              <TabsTrigger value="settings" className="text-xs">
                <SlidersHorizontal className="size-3.5" />
                Settings
              </TabsTrigger>
              <TabsTrigger value="connections" className="text-xs">
                <Cable className="size-3.5" />
                Tool connections
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {props.onNewConversation && props.showTabs !== false && (
          <Button
            variant="outline"
            size="xs"
            className="ml-1"
            title="Start a new conversation"
            onClick={props.onNewConversation}
          >
            <Plus className="size-3.5" />
            New chat
          </Button>
        )}

        {props.onCreateAgent && props.showTabs !== false && (
          <Button
            variant="outline"
            size="xs"
            className="ml-1"
            title="Create new agent"
            onClick={props.onCreateAgent}
          >
            <Plus className="size-3.5" />
            New agent
          </Button>
        )}
      </div>
    </div>
  );
}
