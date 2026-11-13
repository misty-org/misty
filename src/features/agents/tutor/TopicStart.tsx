import { useState, type FormEvent } from "react";
import { ArrowRight, Globe, MessageCircleQuestion } from "lucide-react";
import { ChoiceTile, IconButton, Input, ListRow, Surface, Text } from "@/shared/ui";
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
    <section className="flex flex-col gap-3" aria-label="Start a notebook">
      <Surface
        as="form"
        tone="page"
        edge="field"
        radius="xl"
        className="flex items-center gap-1.5 p-1.5 pl-3.5"
        onSubmit={submit}
      >
        <Text bare tone="muted" className="inline-flex flex-none">
          <Globe aria-hidden="true" />
        </Text>
        <Input
          variant="bare"
          className="h-9.5 flex-1 px-2"
          aria-label="What do you want to explore?"
          placeholder={topic?.placeholder ?? "What do you want to explore?"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <IconButton label="Start a notebook" type="submit" disabled={!query.trim()}>
          <ArrowRight />
        </IconButton>
      </Surface>
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(144px,1fr))] gap-2"
        role="group"
        aria-label="Topics"
      >
        {notebookTopics.map((item) => (
          <ChoiceTile
            key={item.id}
            look="outline"
            roomy
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
          className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-1"
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
