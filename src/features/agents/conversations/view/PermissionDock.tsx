// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { useEffect, useMemo, useState } from "react";
import { Check, CircleHelp, Clock, X } from "lucide-react";
import { Button, CodeText, OverflowFadeText, Surface, Text, Tooltip } from "@misty/ui";
import { useWorkspaceViewShown } from "@/features/app-windows";
import { ErrorNotice } from "../ErrorNotice";
import {
  actionQuestionVerb,
  answerActionQuestion,
  dockQuestionsFor,
  listenForActionQuestions,
  useActionQuestions,
  type ActionQuestion,
} from "../../island/actionQuestions";
import { toolKind } from "../../progress/progressTimeline";
import { kindIcons } from "../../progress/AgentProgress";

/** What a step asks to do, in a few words, from the tool's name. */
function askSummary(tool: string) {
  const name = tool.toLowerCase().replace(/[^a-z]/g, "");
  if (/^(bash|shell|terminal|command|exec|runcommand|runshellcommand)/.test(name))
    return "Run a command";
  if (/(edit|write|patch|replace|create|apply)/.test(name)) return "Edit files";
  if (/^(read|view|cat|open)/.test(name)) return "Read a file";
  if (/websearch|search/.test(name)) return "Search the web";
  if (/fetch|browse|url/.test(name)) return "Open a web page";
  return `Use ${tool}`;
}

/** A question's tool, summary and the exact thing it acts on (`Bash: npm test`). */
function askParts(question: ActionQuestion) {
  if (question.kind === "action") {
    const cut = question.control.indexOf(": ");
    const tool = cut > 0 ? question.control.slice(0, cut) : question.control;
    const target = cut > 0 ? question.control.slice(cut + 2) : "";
    return { tool, summary: askSummary(tool), target, reason: "" };
  }
  const verb = actionQuestionVerb(question);
  const summary = `${verb[0].toUpperCase()}${verb.slice(1)}${question.site ? ` on ${question.site}` : ""}`;
  return { tool: "", summary, target: question.control, reason: question.reason };
}

/**
 * The agent's permission asks, docked directly above this chat's composer, the way OpenChamber
 * shows them: "Permission required", what the step does and what it acts on, then Deny on the
 * left and Allow once on the right (Always allow between them where it can be remembered).
 * The composer stays usable. While the chat is open the window's control island leaves these
 * questions to it. ⌥↵ allows once, ⌥⇧↵ always allows, ⌥⌫ denies.
 */
export function PermissionDock({ agentId }: { agentId?: string }) {
  useEffect(() => listenForActionQuestions(), []);
  // Only a chat on screen takes the questions; a hidden tab leaves them to the island.
  const shown = useWorkspaceViewShown();
  useEffect(() => (agentId && shown ? dockQuestionsFor(agentId) : undefined), [agentId, shown]);
  const items = useActionQuestions((state) => state.items);
  const questions = useMemo(
    () => (agentId ? items.filter((item) => item.agentId === agentId) : []),
    [items, agentId],
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const question = questions[0];
  const answer = (allow: boolean, remember = false) => {
    if (!question || busy) return;
    // Another pane showing this chat may have answered already.
    if (!useActionQuestions.getState().items.some((item) => item.id === question.id)) return;
    setBusy(question.id);
    setError("");
    void answerActionQuestion(question.id, allow, remember)
      .catch(() =>
        setError(
          remember
            ? "Misty couldn’t remember that approval, so nothing was done. Try again."
            : "That question already closed. Nothing was done.",
        ),
      )
      .finally(() => setBusy(""));
  };
  const rememberable = Boolean(question?.rememberable && question.origin);
  useEffect(() => {
    if (!question || !shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          if (rememberable) answer(true, true);
        } else answer(true);
      } else if (event.key === "Backspace" && !event.shiftKey) {
        event.preventDefault();
        answer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!question || !shown)
    return error ? <ErrorNotice message={error} onDismiss={() => setError("")} /> : null;
  const parts = askParts(question);
  const ToolIcon = parts.tool ? kindIcons[toolKind(parts.tool)] : undefined;
  const closed = busy === question.id;
  return (
    <Surface
      as="section"
      tone="card"
      edge="hairline"
      radius="xl"
      role="dialog"
      aria-label="Permission required"
      className="mb-3 overflow-hidden"
    >
      <div className="flex min-h-8 items-center gap-2 px-3 pt-1.5">
        <Text bare tone="waiting" className="flex shrink-0">
          <CircleHelp aria-hidden="true" />
        </Text>
        <OverflowFadeText className="min-w-0 flex-1">
          <Text bare size="control" tone="default" weight="medium">
            Permission required
          </Text>
        </OverflowFadeText>
        {questions.length > 1 ? (
          <Text bare size="caption" tone="muted" className="shrink-0 tabular-nums">
            1 of {questions.length}
          </Text>
        ) : null}
        {parts.tool ? (
          <Text bare size="meta" tone="muted" className="flex shrink-0 items-center gap-1.5">
            {ToolIcon ? <ToolIcon aria-hidden="true" /> : null}
            {parts.tool}
          </Text>
        ) : null}
      </div>
      <div className="grid max-h-[50vh] gap-1.5 overflow-y-auto overscroll-contain px-3 py-2">
        {parts.reason ? (
          <Text as="p" wrap size="meta" tone="default" className="m-0 whitespace-pre-wrap">
            {parts.reason}
          </Text>
        ) : null}
        <Text as="p" bare size="meta" tone="default" className="m-0 font-medium">
          {parts.summary}
        </Text>
        {parts.target ? (
          <CodeText className="max-h-60 overflow-auto leading-[1.6] break-all whitespace-pre-wrap">
            {parts.target}
          </CodeText>
        ) : null}
      </div>
      <ErrorNotice message={error} onDismiss={() => setError("")} />
      <div className="flex items-center gap-1.5 px-3 pt-1 pb-2.5">
        <Tooltip content="Deny" shortcut="⌥⌫">
          <Button
            variant="quiet"
            size="sm"
            icon={X}
            disabled={closed}
            onClick={() => answer(false)}
          >
            Deny
          </Button>
        </Tooltip>
        <div className="min-w-0 flex-1" />
        {rememberable ? (
          <Tooltip
            content={`Always allow ${actionQuestionVerb(question)} on ${question.origin} while the chat is in Auto`}
            shortcut="⌥⇧↵"
          >
            <Button
              variant="secondary"
              size="sm"
              icon={Clock}
              disabled={closed}
              onClick={() => answer(true, true)}
            >
              Always allow
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip content="Allow once" shortcut="⌥↵">
          <Button
            variant="primary"
            size="sm"
            icon={Check}
            disabled={closed}
            onClick={() => answer(true)}
          >
            Allow once
          </Button>
        </Tooltip>
      </div>
    </Surface>
  );
}
