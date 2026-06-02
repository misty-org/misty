import type { AccountConnection } from "@/api/connections";
import type {
  GoogleCalendarChoice,
  SpaceCalendarSource,
  SpaceIntegration,
} from "@/api/spaces/dto/interfaces/types";
import type { SpaceAgendaVisibility } from "@/features/spaces";
import { MistyBrandIcon } from "@/features/workspace";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Separator,
  Switch,
} from "@/shared/ui";
import { CheckCircle2, LoaderCircle, Plus, Search } from "lucide-react";
import { SiGooglecalendar } from "react-icons/si";
import { useMemo, useState, type ReactNode } from "react";
import { TaskInlineSelect } from "../SpaceTaskPrimitives";

export interface CalendarSourceDrawerProps {
  integrations: SpaceIntegration[];
  accounts: AccountConnection[];
  selectedIntegration: string;
  choices: GoogleCalendarChoice[];
  sources: SpaceCalendarSource[];
  connectionsUnavailable: boolean;
  busy: string;
  canManage?: boolean;
  visibility: SpaceAgendaVisibility;
  onVisibilityChange: (
    next: SpaceAgendaVisibility | ((current: SpaceAgendaVisibility) => SpaceAgendaVisibility),
  ) => void;
  onSelect: (id: string) => void;
  onConnect: () => void;
  onBind: (connection: AccountConnection) => void;
  onPublish: (choice: GoogleCalendarChoice) => void;
  onDisable: (source: SpaceCalendarSource) => void;
  onClose: () => void;
}

/** Connects Google accounts and chooses which calendars are visible in this Space. */
export function CalendarSourceDrawer(props: CalendarSourceDrawerProps) {
  const { selectedIntegration, choices, sources, busy } = props;
  const [query, setQuery] = useState("");
  const [managingAccount, setManagingAccount] = useState(false);
  const activeIntegrations = props.integrations.filter(
    (item) => item.provider === "google" && item.status === "active",
  );
  const availableAccounts = props.accounts.filter(
    (account) =>
      account.provider === "google" &&
      account.status === "active" &&
      account.capabilities?.some(
        (capability) => capability === "calendar_read" || capability === "calendar_write",
      ),
  );
  const googleSources = sources.filter(
    (source) => source.provider === "google" && source.status !== "disabled",
  );
  const selectedAccount = activeIntegrations.find((item) => item.id === selectedIntegration);
  const publishedSources = useMemo(
    () =>
      new Map(
        sources
          .filter((source) => source.status !== "disabled")
          .map(
            (source) =>
              [`${source.integration_id}:${source.external_calendar_id}`, source] as const,
          ),
      ),
    [sources],
  );
  const filteredChoices = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return choices;
    return choices.filter((choice) =>
      [choice.summary, choice.timeZone, choice.accessRole, choice.primary ? "primary" : ""]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [choices, query]);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        aria-label="Google Calendar"
        className="max-h-[85dvh] w-[min(560px,96vw)] gap-0 overflow-hidden bg-charcoal-bg p-0 sm:max-w-[560px]"
      >
        <DialogHeader className="border-b border-charcoal-border/60 px-6 py-5 pr-14 text-left">
          <DialogTitle>Calendars</DialogTitle>
          <DialogDescription>Choose what appears in this Space.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-auto px-6 py-5">
          <section aria-labelledby="shown-calendars-heading">
            <h3 id="shown-calendars-heading" className="mb-2 mt-0 text-sm font-semibold">
              Shown in this Space
            </h3>
            <div className="grid gap-1">
              <CalendarVisibilitySwitch
                checked={calendarCheckedState([props.visibility.tasks, props.visibility.roadmap])}
                description="Tasks and roadmap items"
                icon={<MistyBrandIcon size={20} />}
                label="Misty"
                onCheckedChange={(checked) =>
                  props.onVisibilityChange((current) => ({
                    ...current,
                    tasks: checked,
                    roadmap: checked,
                  }))
                }
              />
              {googleSources.length ? (
                <CalendarVisibilitySwitch
                  checked={calendarCheckedState(
                    googleSources.map(
                      (source) => !props.visibility.hiddenSources.includes(source.id),
                    ),
                  )}
                  description={selectedAccount?.display_name ?? "Connected calendars"}
                  icon={<GoogleCalendarIcon className="size-5" />}
                  label="Google Calendar"
                  onCheckedChange={(checked) =>
                    props.onVisibilityChange((current) => {
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
          </section>

          {props.canManage !== false ? (
            <>
              <Separator className="my-5" />

              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-cream-muted"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search calendars"
                  className="h-10 pl-9 pr-3"
                  autoComplete="off"
                  placeholder="Search calendars"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              <section className="mt-5" aria-labelledby="google-calendars-heading">
                <div className="flex min-h-10 items-center gap-3">
                  <GoogleCalendarIcon className="size-5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h3 id="google-calendars-heading" className="m-0 text-sm font-semibold">
                        Google Calendar
                      </h3>
                      <GoogleConnectionStatus
                        unavailable={props.connectionsUnavailable}
                        connected={activeIntegrations.length > 0}
                      />
                    </div>
                    {selectedAccount ? (
                      <p className="m-0 truncate text-xs text-cream-muted">
                        {selectedAccount.display_name}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-expanded={managingAccount}
                    onClick={() => setManagingAccount((current) => !current)}
                  >
                    {managingAccount ? "Close account settings" : "Manage account"}
                  </Button>
                </div>

                {managingAccount ? (
                  <div className="mt-3 border-y border-charcoal-border/60 py-3">
                    {props.connectionsUnavailable ? (
                      <p className="m-0 text-xs text-cream-muted">
                        Account connections are temporarily unavailable.
                      </p>
                    ) : activeIntegrations.length ? (
                      <TaskInlineSelect
                        label="Account in this Space"
                        disabled={busy === "calendars"}
                        value={selectedIntegration}
                        onChange={props.onSelect}
                        options={activeIntegrations.map((item): [string, string] => [
                          item.id,
                          item.display_name,
                        ])}
                      />
                    ) : availableAccounts.length ? (
                      <div className="grid gap-1">
                        {availableAccounts.map((account) => (
                          <div
                            className="flex min-h-11 items-center gap-3 rounded-md px-2 hover:bg-charcoal-card"
                            key={account.id}
                          >
                            <GoogleCalendarIcon className="size-4" />
                            <span className="min-w-0 flex-1 truncate text-sm">
                              {account.account_display}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === `bind:${account.id}`}
                              onClick={() => props.onBind(account)}
                            >
                              {busy === `bind:${account.id}` ? "Connecting…" : "Use in this Space"}
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="m-0 text-xs text-cream-muted">
                        Add a Google account to choose its calendars.
                      </p>
                    )}
                  </div>
                ) : null}

                <p className="mb-2 mt-4 text-xs text-cream-muted">
                  Choose calendars to share with this Space.
                </p>

                {busy === "calendars" ? (
                  <div className="grid min-h-32 place-items-center text-cream-muted">
                    <LoaderCircle className="size-5 animate-spin" aria-label="Loading calendars" />
                  </div>
                ) : selectedIntegration ? (
                  <div className="grid gap-1">
                    {filteredChoices.map((choice) => {
                      const source = publishedSources.get(`${selectedIntegration}:${choice.id}`);
                      const active = Boolean(source);
                      const actionBusy = busy === choice.id || (source && busy === source.id);
                      return (
                        <CalendarChoiceSwitch
                          active={active}
                          busy={Boolean(actionBusy)}
                          choice={choice}
                          key={choice.id}
                          onCheckedChange={(checked) => {
                            if (checked) props.onPublish(choice);
                            else if (source) props.onDisable(source);
                          }}
                        />
                      );
                    })}
                    {!filteredChoices.length ? (
                      <p className="m-0 rounded-md px-2 py-6 text-center text-xs text-cream-muted">
                        {choices.length
                          ? `No calendars match “${query.trim()}”.`
                          : "No calendars are available for this account."}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="m-0 rounded-md px-2 py-6 text-center text-xs text-cream-muted">
                    Connect or choose a Google account to see its calendars.
                  </p>
                )}
              </section>
            </>
          ) : null}
        </div>

        {props.canManage !== false ? (
          <footer className="flex items-center justify-between gap-3 border-t border-charcoal-border/60 px-6 py-4">
            <Button
              variant="ghost"
              className="-ml-2 text-sage-fg hover:text-sage-fg"
              aria-busy={busy === "connect-google"}
              disabled={busy === "connect-google"}
              onClick={props.onConnect}
            >
              {busy === "connect-google" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Add another account
            </Button>
            <Button onClick={props.onClose}>Done</Button>
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CalendarVisibilitySwitch(props: {
  checked: boolean | "indeterminate";
  description: string;
  icon: ReactNode;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const checked = props.checked !== false;
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-md px-2 hover:bg-charcoal-card">
      {props.icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{props.label}</span>
        <span className="block truncate text-xs text-cream-muted">{props.description}</span>
      </span>
      <Switch
        checked={checked}
        aria-label={`Show ${props.label}`}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}

function CalendarChoiceSwitch(props: {
  active: boolean;
  busy: boolean;
  choice: GoogleCalendarChoice;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-md px-2 hover:bg-charcoal-card has-[:disabled]:opacity-60">
      <span
        className={
          props.choice.primary
            ? "size-3 rounded-full bg-[#4285F4]"
            : "size-3 rounded-full bg-sage-fg"
        }
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{props.choice.summary}</span>
        <span className="block truncate text-xs text-cream-muted">
          {props.choice.primary ? "Primary calendar" : props.choice.timeZone}
        </span>
      </span>
      {props.busy ? <LoaderCircle className="size-4 animate-spin text-cream-muted" /> : null}
      <Switch
        checked={props.active}
        aria-label={`Share ${props.choice.summary}`}
        disabled={props.busy}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  );
}

function GoogleConnectionStatus(props: { unavailable: boolean; connected: boolean }) {
  if (props.unavailable) {
    return <span className="text-xs text-cream-muted">Status unavailable</span>;
  }
  if (!props.connected) return <span className="text-xs text-cream-muted">Not connected</span>;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-sage-fg">
      <CheckCircle2 className="size-3.5" />
      Connected
    </span>
  );
}

function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <SiGooglecalendar className={`shrink-0 text-[#4285F4] ${className ?? ""}`} aria-hidden="true" />
  );
}

function calendarCheckedState(values: boolean[]): boolean | "indeterminate" {
  if (values.length === 0 || values.every(Boolean)) return true;
  return values.some(Boolean) ? "indeterminate" : false;
}
