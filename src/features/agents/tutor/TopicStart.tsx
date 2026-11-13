import { useState, type FormEvent } from "react";
import { ArrowRight, Globe, MessageCircleQuestion } from "lucide-react";
import { ChoiceTile, IconButton, Input, ListRow } from "@/shared/ui";
import { notebookTopics, startOf, topicOf } from "./notebookTopics";
import { jobTitle } from "./tutorPrompts";
import { startJob } from "./tutorRuns";
import { researchPrompt } from "./tutorStudio";
import { useTutorStore } from "./tutorStore";
import type { TutorActions } from "./TutorPage";

/**
 * The top of the Lab's home: what to explore, and the common topics to start from. Asking makes
 * a notebook whose agent finds sources on the web; a topic adds its own guidance and questions.
 */
export function TopicStart({
  actions,
  onError,
}: {
  actions: TutorActions;
  onError(message: string): void;
}) {
  const [query, setQuery] = useState("");
  const [topicId, setTopicId] = useState<string>();
  const topic = topicOf(topicId);

  const start = (text: string) => {
    const typed = text.trim();
    if (!typed) return;
    const plan = startOf(typed);
    const store = useTutorStore.getState();
    const notebook = store.createNotebook(plan.title);
    store.updateNotebook(notebook.id, (current) => ({
      ...current,
      ...(topic ? { topic: topic.id, emoji: topic.emoji } : {}),
    }));
    setQuery("");
    actions.open(`notebook:${notebook.id}`);
    startJob({
      kind: "research",
      title: jobTitle("research", plan.research),
      agentId: actions.agentId,
      notebookId: notebook.id,
      prompt: researchPrompt(plan.research, [], topic?.focus),
    }).catch((reason: unknown) =>
      onError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    start(query);
  };

  return (
    <section className="notebook-start" aria-label="Start a notebook">
      <form className="tutor-research tutor-research-large" onSubmit={submit}>
        <Globe size={16} aria-hidden="true" />
        <Input
          variant="toolbar"
          aria-label="What do you want to explore?"
          placeholder={topic?.placeholder ?? "What do you want to explore?"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton label="Start a notebook" type="submit" disabled={!query.trim()}>
          <ArrowRight />
        </IconButton>
      </form>
      <div className="notebook-topics" role="group" aria-label="Topics">
        {notebookTopics.map((item) => (
          <ChoiceTile
            key={item.id}
            look="outline"
            label={item.label}
            caption={item.label}
            selected={item.id === topicId}
            onSelect={() => setTopicId(item.id === topicId ? undefined : item.id)}
          >
            <item.icon size={20} aria-hidden="true" />
          </ChoiceTile>
        ))}
      </div>
      {topic && (
        <div
          className="notebook-topic-questions"
          role="list"
          aria-label={`${topic.label} questions`}
        >
          {topic.questions.map((question) => (
            <div key={question} role="listitem">
              <ListRow
                label={question}
                leading={MessageCircleQuestion}
                onOpen={() => start(question)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
