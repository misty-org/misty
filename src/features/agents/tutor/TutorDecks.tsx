import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { confirmAction } from "@/shared/lib/confirmAction";
import { Button, IconButton, Input, Textarea } from "@/shared/ui";
import { dueCards, nextLabel, type Grade } from "./spacedReview";
import { useTutorStore } from "./tutorStore";
import type { Deck, Flashcard } from "./tutorTypes";

export function DeckView({
  deck,
  onClose,
  onReview,
}: {
  deck: Deck;
  onClose(): void;
  onReview(): void;
}) {
  const store = useTutorStore.getState();
  const [title, setTitle] = useState(deck.title);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [editing, setEditing] = useState<string>();
  useEffect(() => setTitle(deck.title), [deck.title]);
  const due = dueCards(deck.cards, new Date()).length;
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
      <div className="tutor-lead">
        <IconButton label="Back to Create" onClick={onClose}>
          <ArrowLeft />
        </IconButton>
        <Input
          className="tutor-title-input"
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
      <form className="tutor-card-form" onSubmit={add}>
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
        <div className="tutor-rows">
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
              <div key={card.id} className="tutor-row tutor-flashcard-row">
                <span className="tutor-flashcard-side">{card.front}</span>
                <span className="tutor-flashcard-side tutor-muted">{card.back}</span>
                <span className="tutor-card-detail">{dueText(card)}</span>
                <IconButton label="Edit card" onClick={() => setEditing(card.id)}>
                  <Pencil />
                </IconButton>
                <IconButton label="Delete card" onClick={() => store.removeCard(deck.id, card.id)}>
                  <Trash2 />
                </IconButton>
              </div>
            ),
          )}
        </div>
      ) : null}
    </>
  );
}

function dueText(card: Flashcard): string {
  const days = Math.ceil((Date.parse(card.review.due) - Date.now()) / 86_400_000);
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
      className="tutor-row tutor-card-form"
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
      <div className="tutor-review-done">
        <p className="tutor-card-title">
          {reviewed
            ? `Reviewed ${reviewed} ${reviewed === 1 ? "card" : "cards"}.`
            : "Nothing is due."}
        </p>
        <Button onClick={onDone}>Done</Button>
      </div>
    );
  const now = new Date();
  return (
    <div className="tutor-review">
      <div className="tutor-lead">
        <IconButton label="End review" onClick={onDone}>
          <ArrowLeft />
        </IconButton>
        <span className="tutor-card-detail">{queue.length} left</span>
      </div>
      <div className="tutor-flashcard" data-shown={shown}>
        <div className="tutor-flashcard-front">{card.front}</div>
        {shown ? <div className="tutor-flashcard-back">{card.back}</div> : null}
      </div>
      {shown ? (
        <div className="tutor-grades" role="group" aria-label="How well did you know it?">
          {grades.map((item) => (
            <Button key={item.value} onClick={() => grade(item.value)}>
              <span>{item.label}</span>
              <span className="tutor-card-detail">{nextLabel(card.review, item.value, now)}</span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="tutor-grades">
          <Button onClick={() => setShown(true)}>Show answer</Button>
        </div>
      )}
    </div>
  );
}
