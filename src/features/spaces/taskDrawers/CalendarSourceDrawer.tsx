import { CalendarDays, Check, CircleAlert, LoaderCircle } from "lucide-react";
import {
  Badge,
  Button,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/ui";
import type {
  GoogleCalendarChoice,
  SpaceCalendarSource,
  SpaceIntegration,
} from "@/models/interfaces/features/spaces/types";
import { TaskEmptyState, TaskInlineSelect } from "../SpaceTaskPrimitives";

export interface CalendarSourceDrawerProps {
  integrations: SpaceIntegration[];
  selectedIntegration: string;
  choices: GoogleCalendarChoice[];
  sources: SpaceCalendarSource[];
  connectionsUnavailable: boolean;
  busy: string;
  onSelect: (id: string) => void;
  onPublish: (choice: GoogleCalendarChoice) => void;
  onDisable: (source: SpaceCalendarSource) => void;
  onClose: () => void;
}

/** Chooses which Google calendars are published into this Space. */
export function CalendarSourceDrawer(props: CalendarSourceDrawerProps) {
  const { selectedIntegration, choices, sources, busy } = props;
  const activeIntegrations = props.integrations.filter((item) => item.status === "active");
  const published = new Set(
    sources
      .filter((source) => source.status !== "disabled")
      .map((source) => `${source.integration_id}:${source.external_calendar_id}`),
  );

  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent className="w-[min(480px,96vw)] bg-background p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border/60 px-5 py-4 pr-14 text-left">
          <SheetTitle>Published calendars</SheetTitle>
          <SheetDescription>
            Choose which calendars are visible to members of this Space.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 overflow-auto p-5">
          <TaskInlineSelect
            label="Google account"
            disabled={false}
            value={selectedIntegration}
            onChange={props.onSelect}
            options={[
              ["", "Choose a Google account"],
              ...activeIntegrations.map((item): [string, string] => [item.id, item.display_name]),
            ]}
          />

          {props.connectionsUnavailable ? (
            <TaskEmptyState
              title="Calendar connections unavailable"
              description="Misty could not check Google Calendar connections on this server. Your Space tasks are still available."
            />
          ) : !activeIntegrations.length ? (
            <TaskEmptyState
              title="No Google account connected"
              description="This Space does not currently have a working Google Calendar connection."
            />
          ) : busy === "calendars" ? (
            <div className="grid min-h-40 place-items-center text-muted-foreground">
              <LoaderCircle className="size-5 animate-spin" aria-label="Loading calendars" />
            </div>
          ) : selectedIntegration ? (
            <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-lg bg-muted/30">
              {choices.map((choice) => {
                const active = published.has(`${selectedIntegration}:${choice.id}`);
                return (
                  <div className="flex items-center gap-3 p-3" key={choice.id}>
                    <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{choice.summary}</span>
                    <Button
                      size="sm"
                      variant={active ? "secondary" : "outline"}
                      disabled={active || busy === choice.id}
                      type="button"
                      onClick={() => props.onPublish(choice)}
                    >
                      {active ? "Added" : "Add"}
                    </Button>
                  </div>
                );
              })}
              {!choices.length ? (
                <p className="text-xs text-muted-foreground">
                  No calendars are available for this account.
                </p>
              ) : null}
            </div>
          ) : null}

          <Separator className="my-5" />
          <h3 className="mb-2 mt-0 text-sm font-semibold">Space calendars</h3>
          <div className="grid gap-1">
            {sources.map((source) => (
              <div
                className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-muted"
                key={source.id}
              >
                {source.status === "active" ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <CircleAlert className="size-4 text-amber-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{source.display_name}</span>
                {source.status !== "disabled" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === source.id}
                    type="button"
                    onClick={() => props.onDisable(source)}
                  >
                    Disable
                  </Button>
                ) : (
                  <Badge variant="outline">Disabled</Badge>
                )}
              </div>
            ))}
            {!sources.length ? (
              <p className="text-xs text-muted-foreground">No calendars published yet.</p>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
