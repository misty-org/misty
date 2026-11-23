import { LocalToolRejected, type LocalToolHandler } from "../host";
import {
  changeConversationState,
  publicQuestionSet,
  readConversationState,
  type StoredQuestionSet,
} from "./conversation_state";
import {
  confirmationQuestion,
  confirmationRefused,
  endOpenQuestionSets,
  handOffQuestionSet,
  openQuestionSet,
  questionAnswersResult,
} from "./questions";
import { askUserSchema } from "./schemas";
import { chatOf, checkedInput, contextOf, correctable, showEvent } from "./tool_support";

type Question = Parameters<typeof confirmationQuestion>[0];

const pollMs = 1000;

const awaitingAnswer = (set: StoredQuestionSet) => ({
  status: "awaiting_answer",
  question_set: set.id,
  message:
    "The questions are showing above the user's composer. This run ends here; Misty continues the conversation once the user answers.",
  user_message: "Answer the question above and Misty continues.",
});

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      done();
    };
    const timer = setTimeout(finish, pollMs);
    signal.addEventListener("abort", finish);
  });
}

async function held(
  account: string,
  conversationId: string,
  set: StoredQuestionSet,
  signal: AbortSignal,
): Promise<StoredQuestionSet> {
  const deadline = Date.parse(set.waitUntil);
  let current = set;
  while (!signal.aborted && Date.now() < deadline) {
    await pause(signal);
    const state = await readConversationState(account, conversationId);
    current = state.questionSets.find((item) => item.id === set.id) ?? current;
    if (current.state !== "pending") return current;
  }
  return changeConversationState(account, conversationId, (state) =>
    handOffQuestionSet(state, set.id),
  );
}

const cancelled = (signal: AbortSignal) =>
  signal.aborted && (signal.reason as Error | undefined)?.message === "agent_tool_cancelled";

export const askUser: LocalToolHandler = async (request) => {
  const input = checkedInput<{ questions: Question[] }>(request, askUserSchema);
  if (input.questions.some(confirmationQuestion))
    return { status: "failure", tool_error: { message: confirmationRefused } };
  const context = await contextOf(request.runId);
  const conversationId = chatOf(context, "This run has no conversation to ask in.");
  const { set: opened, created } = await correctable(
    () =>
      changeConversationState(context.account, conversationId, (state) =>
        openQuestionSet(state, {
          id: `question_${crypto.randomUUID()}`,
          runId: request.runId,
          callId: request.callId,
          questions: input.questions,
          now: Date.now(),
        }),
      ),
    {
      invalid:
        "Ask 1-4 questions, each with a short header, a full question and 2-4 distinct options. Do " +
        "not add an Other option; the user can always write their own answer.",
    },
  );
  let set = opened;
  if (set.state === "pending" && !set.handedOff) {
    if (created)
      showEvent(request.runId, context, {
        type: "question.requested",
        questionSet: publicQuestionSet(set),
      });
    set = await held(context.account, conversationId, set, request.signal);
  }
  if (set.state === "pending" && cancelled(request.signal)) {
    await changeConversationState(context.account, conversationId, (state) => {
      const { state: next } = endOpenQuestionSets(state, "canceled", request.runId);
      return { next, result: undefined };
    });
    throw new LocalToolRejected("question_canceled", "The run stopped before an answer came.");
  }
  if (set.state === "answered")
    return set.continued ? awaitingAnswer(set) : questionAnswersResult(set);
  if (set.state === "pending") return awaitingAnswer(set);
  if (set.state === "superseded")
    return {
      status: "skipped",
      note: "The user sent a new message instead of answering. Read it and continue from it.",
    };
  throw new LocalToolRejected(
    "invalid_request",
    "The questions ended without an answer. Continue with clearly stated assumptions, or ask again only if it is essential.",
  );
};
