// Layout adapted from OpenChamber (MIT, Copyright (c) 2025 Bohdan Triapitsyn).
import { useEffect, useMemo, useState } from "react";
import { Check, CircleHelp, Clock, X } from "lucide-react";
import { Button, CodeText, OverflowFadeText, QuestionPanel, Text, Tooltip } from "@misty/ui";
import { useWorkspaceViewShown } from "@/features/app-windows";
import { ErrorNotice } from "../ErrorNotice";
import {
  actionQuestionRemembers,
  actionQuestionVerb,
  answerActionQuestion,
  dockQuestionsFor,
  listenForActionQuestions,
  useActionQuestions,
  type ActionQuestion,
} from "../../island/action_questions";
import { toolKind } from "../../progress/progress_timeline";
import { kindIcons } from "../../progress/AgentProgress";

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

export function PermissionDock({ agentId }: { agentId?: string }) {
  useEffect(() => listenForActionQuestions(), []);
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
  const aside = [parts.tool, questions.length > 1 ? `1 of ${questions.length}` : ""]
    .filter(Boolean)
    .join(", ");
  return (
    <QuestionPanel
      label="Permission required"
      title={
        <Text bare size="control" tone="bright" weight="medium" className="flex items-center gap-2">
          <Text bare tone="waiting" className="flex shrink-0">
            {ToolIcon ? <ToolIcon aria-hidden="true" /> : <CircleHelp aria-hidden="true" />}
          </Text>
          <OverflowFadeText className="min-w-0 flex-1">Permission required</OverflowFadeText>
        </Text>
      }
      aside={aside || undefined}
      error={error}
      actions={
        <>
          <Tooltip content="Allow once" shortcut="⌥↵">
            <Button variant="primary" icon={Check} disabled={closed} onClick={() => answer(true)}>
              Allow once
            </Button>
          </Tooltip>
          {rememberable ? (
            <Tooltip content={actionQuestionRemembers(question)} shortcut="⌥⇧↵">
              <Button
                variant="secondary"
                icon={Clock}
                disabled={closed}
                onClick={() => answer(true, true)}
              >
                Always allow
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="Deny" shortcut="⌥⌫">
            <Button variant="quiet" icon={X} disabled={closed} onClick={() => answer(false)}>
              Deny
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="grid max-h-[50vh] gap-1.5 overflow-y-auto overscroll-contain">
        {parts.reason ? (
          <Text as="p" wrap size="meta" tone="default" className="m-0 whitespace-pre-wrap">
            {parts.reason}
          </Text>
        ) : null}
        <Text weight="medium" as="p" bare size="meta" tone="default" className="m-0">
          {parts.summary}
        </Text>
        {parts.target ? (
          <CodeText className="max-h-60 overflow-auto leading-[1.6] break-all whitespace-pre-wrap">
            {parts.target}
          </CodeText>
        ) : null}
      </div>
    </QuestionPanel>
  );
}
