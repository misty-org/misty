import { useActivityStore } from "@/features/activity";
import {
  AiSurfaceButton,
  useAiSurfaceAdapter,
  type AiSurfaceAdapter,
} from "@/features/ai-surface/AiPaneHost";
import { useAuth } from "@/features/auth";
import { preferredMistySpace } from "@/features/spaces";
import { Button } from "@/shared/ui";
import { RefreshCcw } from "lucide-react";
import { useMemo } from "react";
import { HomeCommandInput } from "./components/HomeCommandInput";
import { HomeRecentCard } from "./components/HomeRecentCard";
import { HomeStatusCard } from "./components/HomeStatusCard";
import { ImportantCard } from "./components/ImportantCard";
import { TodayCard } from "./components/TodayCard";
import { dayPart, firstName, formatFullDate } from "./homeFormat";
import { useHomeDashboardData } from "./useHomeDashboardData";
import { useHomeRecents } from "./useHomeRecents";
import { useHomeStatus } from "./useHomeStatus";
import { useHomeTaskActions } from "./useHomeTaskActions";

const homeContentClass = [
  "mx-auto flex min-h-full w-full max-w-[1240px] flex-col gap-8",
  "px-[clamp(20px,4.5vw,64px)] pb-[clamp(28px,4vh,48px)]",
  "pt-[clamp(28px,4.5vh,52px)]",
].join(" ");

export function HomeDashboard() {
  const { user } = useAuth();
  const accountId = user?.id ?? "";
  // No "there" fallback: an unresolved profile should read as a plain greeting
  // rather than claiming the app knows who you are and getting it wrong.
  const name = firstName(user?.name || user?.email || "");
  const data = useHomeDashboardData(accountId);
  const recents = useHomeRecents();
  const status = useHomeStatus();
  const taskActions = useHomeTaskActions(data.refreshAgenda);
  const attentionItems = useActivityStore((state) => state.attentionItems);
  const openActivityItem = useActivityStore((state) => state.openItem);
  const markRead = useActivityStore((state) => state.markRead);

  const importantItems = useMemo(
    () => attentionItems.filter((item) => item.accountId === accountId).slice(0, 4),
    [accountId, attentionItems],
  );
  const quickAddSpaceId = preferredMistySpace(data.spaces)?.id ?? "";
  const aiAdapter = useMemo<AiSurfaceAdapter>(() => {
    const content = JSON.stringify({
      visible_agenda: data.agenda,
      needs_attention: importantItems.map((item) => ({
        kind: item.kind,
        title: item.title,
        body: item.body,
        created_at: item.createdAt,
      })),
      status,
    }).slice(0, 32 << 10);
    return {
      surfaceId: "home",
      label: "Home",
      getContext: () => [
        { kind: "route", id: "home", title: "Home", privacy: "private", href: "/home" },
      ],
      getSelection: () => ({
        kind: "objects",
        content,
        object: { kind: "home", id: accountId || "current-account" },
        anchors: { generated_at: new Date().toISOString() },
        contentHash: homeAiHash(content),
      }),
      getSuggestedActions: () => [
        {
          id: "daily-brief",
          label: "Daily brief",
          prompt:
            "Create a grounded briefing for today using my visible Home state and currently authorized Misty sources.",
        },
        {
          id: "blockers",
          label: "Find blockers",
          prompt:
            "Identify the most important blockers, overdue commitments, and things needing attention. Cite account sources where available.",
        },
        {
          id: "approvals",
          label: "Approval summary",
          prompt:
            "Summarize items that need my review or approval and explain the consequence of each.",
        },
        {
          id: "agent-recap",
          label: "Agent work recap",
          prompt: "Recap recent completed and failed Agent work and tell me what needs follow-up.",
        },
      ],
    };
  }, [accountId, data.agenda, importantItems, status]);
  useAiSurfaceAdapter(aiAdapter);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-charcoal-bg">
      <div className="h-full min-h-0 overflow-y-auto">
        <div className={homeContentClass}>
          <header className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-cream-muted">{formatFullDate(new Date())}</p>
              <h1 className="mt-2 text-[clamp(30px,3.2vw,44px)] font-semibold tracking-[-0.035em] text-cream-bright">
                Good {dayPart()}
                {name ? `, ${name}` : ""}
              </h1>
            </div>
            <AiSurfaceButton className="mt-1" />
          </header>

          <HomeCommandInput />

          <div className="grid gap-4 md:grid-cols-2">
            <TodayCard
              items={data.agenda}
              loading={data.agendaLoading}
              failures={data.agendaFailures}
              quickAddSpaceId={quickAddSpaceId}
              pending={taskActions.pending}
              error={taskActions.error}
              onRetry={() => void data.refreshAgenda()}
              onComplete={(spaceId, taskId) => void taskActions.completeTask(spaceId, taskId)}
              onAdd={(spaceId, title) => void taskActions.addTask(spaceId, title)}
            />
            <ImportantCard
              items={importantItems}
              onOpen={openActivityItem}
              onDismiss={markRead}
              onDismissAll={() => importantItems.forEach((item) => markRead(item.id))}
            />
            <HomeRecentCard items={recents} />
            <HomeStatusCard status={status} />
          </div>

          {data.error && !data.snapshotReady ? (
            <div className="flex items-center justify-between rounded-lg border border-charcoal-border bg-charcoal-card px-4 py-3 text-sm text-cream-muted">
              <span>Home couldn’t refresh.</span>
              <Button variant="ghost" size="sm" onClick={() => void data.refresh()}>
                <RefreshCcw className="size-4" />
                Retry
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function homeAiHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16)}`;
}
