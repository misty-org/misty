import type { ScheduledTaskInput } from "@/api/scheduled/api";
import { Button, WorkspaceSuggestion, WorkspaceWelcome } from "@/shared/ui";
import { BookOpenText, CalendarDays, Clock3, Moon, Plus, Sun } from "lucide-react";

export type ScheduledStarter = Pick<
  ScheduledTaskInput,
  "title" | "prompt" | "cadence" | "local_time"
> & { weekday?: number };
const suggestions = [
  {
    icon: Sun,
    title: "Morning overview",
    description: "Start the day with your priorities and what’s coming up.",
    prompt:
      "Give me a concise overview of today's priorities and upcoming tasks in my accessible Spaces.",
    cadence: "daily",
    local_time: "08:00",
  },
  {
    icon: Moon,
    title: "Evening reflection",
    description: "Make a little time to reflect on your day.",
    prompt: "Help me reflect on today with three short journal prompts.",
    cadence: "daily",
    local_time: "20:30",
  },
  {
    icon: CalendarDays,
    title: "Weekly planning",
    description: "Review the week and choose what to focus on next.",
    prompt: "Review my accessible Planner tasks and help me choose priorities for the coming week.",
    cadence: "weekly",
    local_time: "17:00",
    weekday: 0,
  },
  {
    icon: BookOpenText,
    title: "Reading reminder",
    description: "Set aside time to return to something in your Library.",
    prompt: "Remind me to spend a little time reading something I saved in my Library.",
    cadence: "daily",
    local_time: "19:00",
  },
] satisfies (ScheduledStarter & { icon: typeof Sun; description: string })[];

export function ScheduledWelcome({ onCreate }: { onCreate: (starter?: ScheduledStarter) => void }) {
  return (
    <WorkspaceWelcome
      icon={<Clock3 size={48} strokeWidth={1.5} />}
      title="Make time for what matters"
      description="Let Misty take care of the things you do regularly."
      action={
        <Button variant="outline" onClick={() => onCreate()}>
          <Plus />
          Create your own task
        </Button>
      }
    >
      {suggestions.map(({ icon: Icon, description, ...starter }) => (
        <WorkspaceSuggestion
          key={starter.title}
          title={starter.title}
          icon={<Icon size={24} />}
          onClick={() => onCreate(starter)}
        >
          {description}
        </WorkspaceSuggestion>
      ))}
    </WorkspaceWelcome>
  );
}
