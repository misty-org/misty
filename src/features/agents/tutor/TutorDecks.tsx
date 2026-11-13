import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Input, Separator, Surface, Text, Textarea } from "@/shared/ui";
import { dueCards, nextLabel, type Grade } from "./spacedReview";
import { useTutorStore } from "./tutorStore";
import type { Deck, Flashcard } from "./tutorTypes";
import { useNow } from "@/shared/hooks/useNow";

export function DeckView({
  deck,
  onClose,
  onReview,
}: {
  deck: Deck;
  onClose(): void;
  onReview(): void;
}) {
  const now = useNow();
  const store = useTutorStore.getState();
  const [title, setTitle] = useState(deck.title);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [editing, setEditing] = useState<string>();
  useEffect(() => setTitle(deck.title), [deck.title]);
  const due = dueCards(deck.cards, new Date(now)).length;
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!front.trim() || !back.trim()) return;
    store.addCards(deck.id, [{ front, back }]);
    setFront("");
    setBack("");
  };
  const remove = async () => {
    if (!(await confirmAction(`Delete “${deck.title}” and its cards? This can’t be undone.`)))
      return;
    store.removeDeck(deck.id);
    onClose();
  };
  return (
    <>
      <div className="flex min-h-9 items-center justify-between gap-2">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <Input
          variant="title"
          className="flex-1"
          aria-label="Deck name"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() =>
            title.trim() && title !== deck.title && store.saveDeck({ ...deck, title: title.trim() })
          }
        />
        <Button disabled={!due} onClick={onReview}>
          {due ? `Review ${due}` : "Nothing due"}
        </Button>
        <IconButton label="Delete deck" onClick={() => void remove()}>
          <Trash2 />
        </IconButton>
      </div>
      <form className="flex flex-col gap-2 [&>button]:self-start" onSubmit={add}>
        <Textarea
          rows={2}
          aria-label="Front"
          placeholder="Front"
          value={front}
          onChange={(event) => setFront(event.target.value)}
        />
        <Textarea
          rows={2}
          aria-label="Back"
          placeholder="Back"
          value={back}
          onChange={(event) => setBack(event.target.value)}
        />
        <Button type="submit" disabled={!front.trim() || !back.trim()}>
          Add card
        </Button>
      </form>
      {deck.cards.length ? (
        <Surface
          tone="none"
          edge="hairline"
          radius="xl"
          className="flex flex-col divide-y overflow-hidden"
        >
          {deck.cards.map((card) =>
            editing === card.id ? (
              <CardEditor
                key={card.id}
                card={card}
                onDone={(change) => {
                  if (change) store.updateCard(deck.id, card.id, change);
                  setEditing(undefined);
                }}
              />
            ) : (
              <div
                key={card.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto] items-start gap-3 px-3.5 py-2.5"
              >
                <Text size="meta" wrap className="whitespace-pre-wrap">
                  {card.front}
                </Text>
                <Text size="meta" tone="muted" wrap className="whitespace-pre-wrap">
                  {card.back}
                </Text>
                <Text bare size="caption" tone="muted" className="flex-none">
                  {dueText(card, now)}
                </Text>
                <IconButton label="Edit card" onClick={() => setEditing(card.id)}>
                  <Pencil />
                </IconButton>
                <IconButton label="Delete card" onClick={() => store.removeCard(deck.id, card.id)}>
                  <Trash2 />
                </IconButton>
              </div>
            ),
          )}
        </Surface>
      ) : null}
    </>
  );
}

function dueText(card: Flashcard, now: number): string {
  const days = Math.ceil((Date.parse(card.review.due) - now) / 86_400_000);
  if (days <= 0) return "Due";
  return days === 1 ? "Tomorrow" : `In ${days} days`;
}

function CardEditor({
  card,
  onDone,
}: {
  card: Flashcard;
  onDone(change?: Pick<Flashcard, "front" | "back">): void;
}) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  return (
    <form
      className="flex flex-col gap-2 px-3.5 py-2.5 [&>button]:self-start"
      onSubmit={(event) => {
        event.preventDefault();
        onDone(
          front.trim() && back.trim() ? { front: front.trim(), back: back.trim() } : undefined,
        );
      }}
    >
      <Textarea
        rows={2}
        aria-label="Front"
        value={front}
        onChange={(e) => setFront(e.target.value)}
      />
      <Textarea rows={2} aria-label="Back" value={back} onChange={(e) => setBack(e.target.value)} />
      <div className="flex gap-1.5">
        <Button type="submit">Save</Button>
        <Button type="button" variant="quiet" onClick={() => onDone()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const grades: { value: Grade; label: string; key: string }[] = [
  { value: "again", label: "Again", key: "1" },
  { value: "hard", label: "Hard", key: "2" },
  { value: "good", label: "Good", key: "3" },
  { value: "easy", label: "Easy", key: "4" },
];

/**
 * One card at a time: the front, then the back on Space, then a grade (1 to 4) that schedules it.
 * A card graded Again comes back at the end of this session.
 */
export function ReviewSession({ decks, onDone }: { decks: Deck[]; onDone(): void }) {
  // The queue is fixed when the session starts, so grading doesn't reshuffle it.
  const [queue, setQueue] = useState(() => {
    const now = new Date();
    return decks
      .flatMap((deck) =>
        dueCards(deck.cards, now).map((card) => ({ deckId: deck.id, cardId: card.id })),
      )
      .slice(0, 100);
  });
  const [shown, setShown] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const current = queue[0];
  const card = useMemo(() => {
    if (!current) return undefined;
    return decks
      .find((deck) => deck.id === current.deckId)
      ?.cards.find((c) => c.id === current.cardId);
  }, [current, decks]);
  const grade = (value: Grade) => {
    if (!current || !card) return;
    useTutorStore.getState().grade(current.deckId, current.cardId, value);
    setReviewed((n) => n + 1);
    setShown(false);
    setQueue(([first, ...rest]) => (value === "again" ? [...rest, first] : rest));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (!shown && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
        setShown(true);
      } else if (shown) {
        const match = grades.find((item) => item.key === event.key);
        if (match) {
          event.preventDefault();
          grade(match.value);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card)
    return (
      <div className="flex flex-col items-center gap-3.5 py-16">
        <Text as="p" size="control" tone="bright">
          {reviewed
            ? `Reviewed ${reviewed} ${reviewed === 1 ? "card" : "cards"}.`
            : "Nothing is due."}
        </Text>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  const now = new Date();
  return (
    <div className="flex flex-col gap-4.5">
      <div className="flex min-h-9 items-center justify-between gap-2">
        <IconButton label="End review" onClick={onDone}>
          <ArrowLeft />
        </IconButton>
        <Text bare size="caption" tone="muted" className="flex-none">
          {queue.length} left
        </Text>
      </div>
      <Surface
        tone="card"
        edge="hairline"
        radius="xl"
        className="flex min-h-65 flex-col justify-center gap-5.5 p-8 text-center whitespace-pre-wrap [overflow-wrap:anywhere]"
        data-shown={shown}
      >
        <Text bare as="div" size="title" tone="bright" className="leading-[1.5]">
          {card.front}
        </Text>
        {shown ? (
          <>
            <Separator />
            <Text bare as="div" size="body" tone="default" className="leading-[1.6]">
              {card.back}
            </Text>
          </>
        ) : null}
      </Surface>
      {shown ? (
        <div
          className="flex justify-center gap-2"
          role="group"
          aria-label="How well did you know it?"
        >
          {grades.map((item) => (
            <Button
              key={item.value}
              caption={nextLabel(card.review, item.value, now)}
              onClick={() => grade(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex justify-center gap-2">
          <Button onClick={() => setShown(true)}>Show answer</Button>
        </div>
      )}
    </div>
  );
}
