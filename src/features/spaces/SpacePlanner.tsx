export type { TaskViewMode, DueFilter } from "@/models/types/features/spaces/SpacePlanner";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { useSpacesStore } from "@/stores/spaces/useSpacesStore";
import type { TaskViewMode } from "@/models/types/features/spaces/SpacePlanner";
import type { SpaceCalendarEvent, SpaceMember } from "@/models/interfaces/features/spaces/types";
import { SpacePlannerHeader } from "./components/SpacePlannerHeader";
import { CalendarSourceDrawer, SpaceTaskDrawer, SpaceTaskEventDrawer } from "./SpacePlannerViews";
import { SpacePlannerBody } from "./spaceTasks/SpacePlannerBody";
import { TaskFilters } from "./spaceTasks/TaskFilters";
import { normalizeView } from "./spaceTasks/taskFiltering";
import { useCalendarPublishing } from "./spaceTasks/useCalendarPublishing";
import { useCreateTaskShortcut } from "./spaceTasks/useCreateTaskShortcut";
import { useSpaceTaskActions } from "./spaceTasks/useSpaceTaskActions";
import { useSpaceTasksData } from "./spaceTasks/useSpaceTasksData";
import { useTaskFilterParams } from "./spaceTasks/useTaskFilterParams";

const emptyMembers: SpaceMember[] = [];

export function SpacePlanner({
  spaceId,
  canManage,
  canManageIntegrations,
}: {
  spaceId: string;
  canManage: boolean;
  canManageIntegrations: boolean;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const members = useSpacesStore((state) => state.membersBySpace[spaceId] ?? emptyMembers);
  const routeParts = location.pathname.split("/").filter(Boolean);
  const view = normalizeView(routeParts[routeParts.length - 1]);

  const filters = useTaskFilterParams({ view, currentUserId: user?.id });
  const data = useSpaceTasksData({ spaceId, view, filters });
  const actions = useSpaceTaskActions({ spaceId, canManage, data });
  const calendar = useCalendarPublishing({ spaceId, data, actions });
  const [eventOpen, setEventOpen] = useState<SpaceCalendarEvent>();

  const openCreate = useCallback(() => actions.openCreate(), [actions.openCreate]);
  useCreateTaskShortcut(canManage, openCreate);

  const changeView = (next: TaskViewMode) =>
    navigate(
      `/spaces/${encodeURIComponent(spaceId)}/planner/${next}${
        filters.searchParams.size ? `?${filters.searchParams}` : ""
      }`,
    );

  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background">
      <SpacePlannerHeader
        view={view}
        query={filters.query}
        activeFilterCount={filters.activeFilterCount}
        sources={data.sources}
        loading={data.loading}
        canManage={canManage}
        canManageIntegrations={canManageIntegrations}
        calendarImportAvailable={
          data.sources.length > 0 ||
          data.integrations.some((integration) => integration.status === "active")
        }
        onView={changeView}
        onQuery={(value: string) => filters.updateParam("q", value)}
        onSync={() => void data.load(false)}
        onImport={() => calendar.setSourceOpen(true)}
        onCreate={openCreate}
        filters={
          <TaskFilters
            members={members}
            status={filters.status}
            assignee={filters.assignee}
            priority={filters.priority}
            due={filters.due}
            mine={filters.mine}
            sort={filters.sort}
            onChange={filters.updateParam}
            onClear={filters.clearFilters}
          />
        }
      />

      <SpacePlannerBody
        view={view}
        members={members}
        canManage={canManage}
        assignee={filters.assignee}
        due={filters.due}
        data={data}
        actions={actions}
        onOpenEvent={setEventOpen}
      />

      {actions.editing !== undefined ? (
        <SpaceTaskDrawer
          draft={actions.draft}
          setDraft={actions.setDraft}
          editing={actions.editing}
          members={members}
          busy={actions.busy === "task" || actions.busy === actions.editing?.id}
          canManage={canManage}
          onClose={() => actions.setEditing(undefined)}
          onSave={actions.save}
          onArchive={actions.editing ? () => void actions.archive(actions.editing!) : undefined}
          onPublishCalendar={
            actions.editing?.calendar
              ? () => void calendar.publishTask(actions.editing!)
              : undefined
          }
          onDiscardCalendar={
            actions.editing?.calendar
              ? () => void calendar.discardTaskChanges(actions.editing!)
              : undefined
          }
        />
      ) : null}

      {eventOpen ? (
        <SpaceTaskEventDrawer
          event={eventOpen}
          source={data.sources.find((item) => item.id === eventOpen.source_id)}
          onClose={() => setEventOpen(undefined)}
        />
      ) : null}

      {calendar.sourceOpen ? (
        <CalendarSourceDrawer
          integrations={data.integrations}
          selectedIntegration={calendar.selectedIntegration}
          choices={calendar.calendarChoices}
          sources={data.sources}
          connectionsUnavailable={data.connectionsUnavailable}
          busy={actions.busy}
          onSelect={(id) => void calendar.loadCalendars(id)}
          onPublish={(choice) => void calendar.publishCalendar(choice)}
          onDisable={calendar.disableSource}
          onClose={() => calendar.setSourceOpen(false)}
        />
      ) : null}
    </div>
  );
}
