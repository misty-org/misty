import { useEffect, useRef, useState } from "react";
import type { CallPerson, CallVideo } from "./use_live_kit_call";

export const STRIP_SEEN = 3;

export function featured(people: CallPerson[], pinned: string | null): CallVideo | undefined {
  const pick = people.find((person) => person.id === pinned);
  const screen = people.find((person) => !person.self && person.screen);
  return (
    pick?.screen ??
    pick?.camera ??
    screen?.screen ??
    people.find((person) => !person.self && person.camera)?.camera ??
    people.find((person) => person.self)?.camera
  );
}

export function useStableOrder(people: CallPerson[], focused: boolean): CallPerson[] {
  const [order, setOrder] = useState<string[]>([]);
  const before = useRef(new Set<string>());
  const ids = people.map((person) => person.id).join(",");
  const active = people
    .filter((person) => person.speaking || person.hand)
    .map((person) => person.id)
    .join(",");
  const self = people.find((person) => person.self)?.id;
  useEffect(() => {
    const present = new Set(ids ? ids.split(",") : []);
    const now = new Set(active ? active.split(",") : []);
    const rose = [...now].filter((id) => !before.current.has(id));
    before.current = now;
    setOrder((current) => {
      const next = current.filter((id) => present.has(id));
      for (const id of present) if (!next.includes(id)) next.push(id);
      if (self) {
        const at = next.indexOf(self);
        if (at > 0) next.unshift(...next.splice(at, 1));
      }
      if (focused)
        for (const id of rose) {
          const at = next.indexOf(id);
          if (at >= STRIP_SEEN) next.splice(self ? 1 : 0, 0, ...next.splice(at, 1));
        }
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [ids, active, self, focused]);
  const place = new Map(order.map((id, index) => [id, index]));
  return [...people].sort(
    (a, b) =>
      (place.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (place.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
