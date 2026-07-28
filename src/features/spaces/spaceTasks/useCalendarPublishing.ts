import { useState } from "react";
import { confirmAction } from "@/lib/confirmAction";
import { errorText } from "@/lib/format";
import { spacesApi } from "@/stores/spaces/useSpacesBackendStore";
import type {
  GoogleCalendarChoice,
  SpaceCalendarSource,
  SpaceTask,
} from "@/models/interfaces/features/spaces/types";
import { taskDraft } from "./taskDraft";
import { mergeTasks } from "./taskOrdering";
import type { SpaceTasksData } from "./useSpaceTasksData";
import type { SpaceTaskActions } from "./useSpaceTaskActions";

/** Google Calendar import and per-task publishing. */
export function useCalendarPublishing(options: {
  spaceId: string;
  data: SpaceTasksData;
  actions: SpaceTaskActions;
}) {
  const { spaceId, data, actions } = options;
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [calendarChoices, setCalendarChoices] = useState<GoogleCalendarChoice[]>([]);

  const run = async (key: string, action: () => Promise<void>) => {
    actions.setBusy(key);
    try {
      await action();
    } catch (reason) {
      data.setError(errorText(reason));
    } finally {
      actions.setBusy("");
    }
  };

  const loadCalendars = async (integrationId: string) => {
    setSelectedIntegration(integrationId);
    setCalendarChoices([]);
    if (!integrationId) return;
    await run("calendars", async () => {
      setCalendarChoices((await spacesApi.googleCalendars(spaceId, integrationId)).calendars);
    });
  };

  const publishCalendar = async (calendar: GoogleCalendarChoice) => {
    if (!selectedIntegration) return;
    await run(calendar.id, async () => {
      await spacesApi.publishGoogleCalendar(spaceId, selectedIntegration, calendar);
      await data.load(false);
    });
  };

  const disableSource = async (source: SpaceCalendarSource) => {
    await run(source.id, async () => {
      await spacesApi.disableCalendarSource(spaceId, source.id);
      await data.load(false);
    });
  };

  /**
   * Sends a task's schedule to Google. Explicit by design — editing a task in
   * Misty never writes to someone's calendar on its own.
   */
  const publishTask = async (task: SpaceTask) => {
    await run(task.id, async () => {
      const saved = await spacesApi.publishTaskToCalendar(spaceId, task);
      data.setTasks((current) => mergeTasks(current, [saved]));
      actions.setEditing(saved);
      data.setError("");
    });
  };

  const discardTaskChanges = async (task: SpaceTask) => {
    if (!(await confirmAction("Discard your changes and use Google Calendar's version?"))) return;
    await run(task.id, async () => {
      const saved = await spacesApi.resolveTaskCalendarConflict(spaceId, task, "discard_local");
      data.setTasks((current) => mergeTasks(current, [saved]));
      actions.setEditing(saved);
      actions.setDraft(taskDraft(saved));
      data.setError("");
    });
  };

  return {
    sourceOpen,
    setSourceOpen,
    selectedIntegration,
    calendarChoices,
    loadCalendars,
    publishCalendar,
    disableSource,
    publishTask,
    discardTaskChanges,
  };
}
