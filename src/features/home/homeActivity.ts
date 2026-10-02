import { deploymentStorageKey } from "@/api/deployment/api";

export type HomeActivity = Record<string, number>;

const maximumRecordedDays = 370;

export function homeActivityStorageKey(accountId: string, spaceId: string): string {
  return deploymentStorageKey(`misty:home-activity:${accountId || "guest"}:${spaceId}`);
}

export function cacheHomeActivity(
  accountId: string,
  spaceId: string,
  activity: HomeActivity,
): void {
  const trimmed = Object.fromEntries(
    Object.entries(activity)
      .filter(
        ([key, value]) => /^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === "number" && value > 0,
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-maximumRecordedDays),
  );
  try {
    window.localStorage.setItem(
      homeActivityStorageKey(accountId, spaceId),
      JSON.stringify(trimmed),
    );
  } catch {
    // The database remains authoritative when a local cache cannot be written.
  }
}

export function activityStreak(activity: HomeActivity, today: Date): number {
  let streak = 0;
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);
  while (activity[dateKey(cursor)] > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function contributionDates(today: Date, days: number): Date[] {
  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);
  cursor.setDate(cursor.getDate() - Math.max(0, days - 1));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(cursor);
    date.setDate(cursor.getDate() + index);
    return date;
  });
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
