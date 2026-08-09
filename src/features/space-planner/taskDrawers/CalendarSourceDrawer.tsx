import type { SpaceAgendaVisibility } from "@/features/spaces";
import type {
  GoogleCalendarChoice,
  SpaceCalendarSource,
  SpaceIntegration,
} from "@/services/spaces/dto/interfaces/types";
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Separator,
} from "@/shared/ui";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { SiGooglecalendar } from "react-icons/si";
import { TaskEmptyState, TaskInlineSelect } from "../SpaceTaskPrimitives";

export interface CalendarSourceDrawerProps {
  integrations: SpaceIntegration[];
  selectedIntegration: string;
  choices: GoogleCalendarChoice[];
  sources: SpaceCalendarSource[];
  connectionsUnavailable: boolean;
  busy: string;
  canManage?: boolean;
  visibility?: SpaceAgendaVisibility;
  onVisibilityChange?: (
    next: SpaceAgendaVisibility | ((current: SpaceAgendaVisibility) => SpaceAgendaVisibility),
  ) => void;
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
  const googleSources = sources.filter(
    (source) => source.provider === "google" && source.status !== "disabled",
  );

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="w-[min(480px,96vw)] max-h-[85dvh] gap-0 overflow-hidden bg-charcoal-bg p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b border-charcoal-border/60 px-5 py-4 pr-14 text-left">
          <DialogTitle>Calendars</DialogTitle>
          <DialogDescription>
            Choose which calendars are visible to members of this Space.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 max-h-[calc(85dvh-5rem)] overflow-auto p-5">
          {props.visibility && props.onVisibilityChange ? (
            <>
              <h3 className="mb-2 mt-0 text-sm font-semibold">Visible calendars</h3>
              <div className="grid gap-1">
                <CalendarVisibilityToggle
                  checked={calendarCheckedState([props.visibility.tasks, props.visibility.roadmap])}
                  label="Misty"
                  onCheckedChange={(checked) =>
                    props.onVisibilityChange?.((current) => ({
                      ...current,
                      tasks: checked,
                      roadmap: checked,
                    }))
                  }
                />
                {googleSources.length ? (
                  <CalendarVisibilityToggle
                    checked={calendarCheckedState(
                      googleSources.map(
                        (source) => !props.visibility?.hiddenSources.includes(source.id),
                      ),
                    )}
                    label="Google Calendar"
                    onCheckedChange={(checked) =>
                      props.onVisibilityChange?.((current) => {
                        const googleIds = new Set(googleSources.map((source) => source.id));
                        return {
                          ...current,
                          hiddenSources: checked
                            ? current.hiddenSources.filter((id) => !googleIds.has(id))
                            : [...new Set([...current.hiddenSources, ...googleIds])],
                        };
                      })
                    }
                  />
                ) : null}
              </div>
              <Separator className="my-5" />
            </>
          ) : null}

          {props.canManage !== false ? (
            <>
              <TaskInlineSelect
                label="Google account"
                disabled={false}
                value={selectedIntegration}
                onChange={props.onSelect}
                options={[
                  ["", "Choose a Google account"],
                  ...activeIntegrations.map((item): [string, string] => [
                    item.id,
                    item.display_name,
                  ]),
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
                <div className="grid min-h-40 place-items-center text-cream-muted">
                  <LoaderCircle className="size-5 animate-spin" aria-label="Loading calendars" />
                </div>
              ) : selectedIntegration ? (
                <div className="mt-4 divide-y divide-charcoal-border/60 overflow-hidden rounded-lg bg-charcoal-card">
                  {choices.map((choice) => {
                    const active = published.has(`${selectedIntegration}:${choice.id}`);
                    return (
                      <div className="flex items-center gap-3 p-3" key={choice.id}>
                        <SiGooglecalendar className="size-4 shrink-0 text-cream-muted" />
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
                    <p className="text-xs text-cream-muted">
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
                    className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-charcoal-card"
                    key={source.id}
                  >
                    {source.status === "active" ? (
                      <Check className="size-4 text-sage-fg" />
                    ) : (
                      <CircleAlert className="size-4 text-sage-fg" />
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
                  <p className="text-xs text-cream-muted">No calendars published yet.</p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CalendarVisibilityToggle(props: {
  checked: boolean | "indeterminate";
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-charcoal-card">
      <Checkbox
        checked={props.checked}
        aria-label={props.label}
        onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function calendarCheckedState(values: boolean[]): boolean | "indeterminate" {
  if (values.length === 0 || values.every(Boolean)) return true;
  return values.some(Boolean) ? "indeterminate" : false;
}
