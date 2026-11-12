import type { CardReview, Flashcard } from "./tutorTypes";

/** How the person did on a card. */
export type Grade = "again" | "hard" | "good" | "easy";

const day = 24 * 60 * 60 * 1000;

export function newReview(now: Date): CardReview {
  return { due: now.toISOString(), interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

/**
 * The next review after a grade, after SM-2: a pass grows the interval by the card's ease, a miss
 * starts it over and makes the card a little harder. A missed card comes back in ten minutes.
 */
export function schedule(review: CardReview, grade: Grade, now: Date): CardReview {
  const at = now.getTime();
  if (grade === "again")
    return {
      ...review,
      reps: 0,
      lapses: review.lapses + 1,
      interval: 0,
      ease: Math.max(1.3, review.ease - 0.2),
      due: new Date(at + 10 * 60 * 1000).toISOString(),
      reviewedAt: now.toISOString(),
    };
  const ease =
    grade === "hard"
      ? Math.max(1.3, review.ease - 0.15)
      : grade === "easy"
        ? review.ease + 0.15
        : review.ease;
  let interval =
    review.reps === 0 ? 1 : review.reps === 1 ? 3 : Math.round(review.interval * review.ease);
  if (grade === "hard") interval = Math.max(1, Math.round(Math.max(review.interval, 1) * 1.2));
  if (grade === "easy") interval = Math.round(interval * 1.3) + 1;
  interval = Math.min(interval, 365);
  return {
    ...review,
    reps: review.reps + 1,
    interval,
    ease,
    due: new Date(at + interval * day).toISOString(),
    reviewedAt: now.toISOString(),
  };
}

export function isDue(card: Flashcard, now: Date): boolean {
  return Date.parse(card.review.due) <= now.getTime();
}

/** The cards due now, longest overdue first. */
export function dueCards(cards: Flashcard[], now: Date): Flashcard[] {
  return cards
    .filter((card) => isDue(card, now))
    .sort((a, b) => a.review.due.localeCompare(b.review.due));
}

/** When a card graded this way would next come up, for the grade buttons. */
export function nextLabel(review: CardReview, grade: Grade, now: Date): string {
  const next = schedule(review, grade, now);
  const minutes = Math.round((Date.parse(next.due) - now.getTime()) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const days = Math.round(minutes / (60 * 24));
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
