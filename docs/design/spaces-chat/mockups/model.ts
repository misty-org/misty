export type ItemKind = "chat" | "task" | "note" | "drawing" | "file";
export type Filter = "Yours" | "Suggested" | "Favorites";
export type Scenario = "populated" | "empty" | "loading" | "read-only" | "failed";
export type Item = {
  id: string;
  title: string;
  kind: ItemKind;
  creator: string;
  favorite: boolean;
  updated: string;
  reason?: string;
  priority?: number;
  description: string;
};
export type Conversation = {
  id: string;
  title: string;
  group: "Channels" | "Direct messages" | "Connected";
  subtitle: string;
  unread?: number;
  readOnly?: boolean;
};
export type Reaction = { emoji: string; count: number; mine?: boolean };
export type Message = {
  id: string;
  author: string;
  text: string;
  time: string;
  compact?: boolean;
  day?: string;
  reply?: string;
  attachment?: string;
  edited?: boolean;
  failed?: boolean;
  reactions: Reaction[];
};
export type Draft = { text: string; reply?: string; attachments: string[] };
export const blankDraft = (): Draft => ({ text: "", attachments: [] });
export const conversations: Conversation[] = [
  {
    id: "everyone",
    title: "Everyone",
    group: "Channels",
    subtitle: "A little of everything, together.",
    unread: 3,
  },
  {
    id: "weekend",
    title: "Weekend plans",
    group: "Channels",
    subtitle: "Good food, fresh air, and no alarms.",
    unread: 2,
  },
  {
    id: "home",
    title: "Around the house",
    group: "Channels",
    subtitle: "Small projects and things to remember.",
  },
  { id: "maya", title: "Maya Chen", group: "Direct messages", subtitle: "Just you and Maya" },
  { id: "leo", title: "Leo Park", group: "Direct messages", subtitle: "Just you and Leo" },
  {
    id: "bookclub",
    title: "Book club",
    group: "Connected",
    subtitle: "Discord · #reading-room",
    readOnly: true,
  },
];
export const initialItems: Item[] = [
  {
    id: "note-weekend",
    title: "A long weekend by the coast",
    kind: "note",
    creator: "You",
    favorite: true,
    updated: "2026-09-30T20:00:00",
    description:
      "Friday: leave after lunch. Saturday: coastal trail and dinner at home. Sunday: a slow morning before the drive back.",
  },
  {
    id: "task-dinner",
    title: "Book a table for Saturday",
    kind: "task",
    creator: "You",
    favorite: false,
    updated: "2026-09-30T19:00:00",
    reason: "Due today · Assigned to you",
    priority: 1,
    description:
      "A table for six, around 7 pm. Maya suggested the little Italian place near the harbor.",
  },
  {
    id: "everyone",
    title: "Everyone",
    kind: "chat",
    creator: "Maya",
    favorite: true,
    updated: "2026-09-30T18:00:00",
    reason: "You were mentioned",
    priority: 2,
    description: "Maya asked whether the coastal route works for everyone.",
  },
  {
    id: "file-map",
    title: "Coastal trail guide.pdf",
    kind: "file",
    creator: "You",
    favorite: true,
    updated: "2026-09-29T18:00:00",
    description:
      "Illustrative Library file · PDF · 2.4 MB. Trail notes, meeting points, and an easy alternative route.",
  },
  {
    id: "drawing",
    title: "Living room, a few ideas",
    kind: "drawing",
    creator: "You",
    favorite: false,
    updated: "2026-09-29T17:00:00",
    description:
      "Move the reading chair beside the window. Leave the center of the room open and add a small shelf behind the sofa.",
  },
  {
    id: "task-list",
    title: "Check the grocery list",
    kind: "task",
    creator: "Leo",
    favorite: true,
    updated: "2026-09-29T16:00:00",
    reason: "Overdue · Assigned to you",
    priority: 0,
    description:
      "Check what is already in the kitchen before we shop. Bread, tomatoes, coffee, and something for breakfast.",
  },
  {
    id: "note-packing",
    title: "What we’re bringing",
    kind: "note",
    creator: "Maya",
    favorite: false,
    updated: "2026-09-28T18:00:00",
    reason: "Maya requested your input",
    priority: 3,
    description:
      "Maya: I can bring the picnic blanket and a cooler. Add anything else you can bring before Friday.",
  },
  {
    id: "weekend",
    title: "Weekend plans",
    kind: "chat",
    creator: "You",
    favorite: false,
    updated: "2026-09-28T17:00:00",
    description: "The conversation for our next little escape.",
  },
  {
    id: "file-photo",
    title: "September photo collection.zip",
    kind: "file",
    creator: "You",
    favorite: false,
    updated: "2026-09-27T18:00:00",
    description:
      "Illustrative Library file · ZIP · 18 MB. Photos from September, ready to sort together.",
  },
];
export const initialMessages: Record<string, Message[]> = {
  everyone: [
    {
      id: "m1",
      author: "Maya Chen",
      time: "9:41 AM",
      day: "Tuesday, September 29",
      text: "Made a little plan for the weekend. Nothing too ambitious — a walk, a good dinner, and plenty of time to do nothing.",
      reactions: [],
    },
    {
      id: "m2",
      author: "Maya Chen",
      time: "9:42 AM",
      compact: true,
      text: "The trail guide is in Library too, so it’s easy to find later.",
      attachment: "Coastal trail guide.pdf",
      reactions: [{ emoji: "🙌", count: 3 }],
    },
    {
      id: "m3",
      author: "Leo Park",
      time: "9:48 AM",
      text: "“Plenty of time to do nothing” is exactly the itinerary I was hoping for.",
      reactions: [{ emoji: "😂", count: 2, mine: true }],
    },
    {
      id: "m4",
      author: "You",
      time: "9:52 AM",
      text: "I’ll take care of dinner. Does 7 work for everyone?",
      reactions: [{ emoji: "👍", count: 3 }],
      edited: true,
    },
    {
      id: "m5",
      author: "Maya Chen",
      time: "10:04 AM",
      day: "Today, September 30",
      reply: "m4",
      text: "Perfect. @You could you book for six? Sam and Jo can make it now.",
      reactions: [{ emoji: "👍", count: 1, mine: true }],
    },
    {
      id: "m6",
      author: "Sam Rivera",
      time: "10:08 AM",
      text: "We’re in! I can bring coffee and something for breakfast.",
      reactions: [],
    },
    {
      id: "m7",
      author: "You",
      time: "10:12 AM",
      text: "Table for six, coffee covered. This is coming together nicely.",
      reactions: [],
    },
  ],
  weekend: [
    {
      id: "w1",
      author: "Maya Chen",
      time: "8:30 AM",
      day: "Today, September 30",
      text: "Do we want to leave Friday after lunch? The scenic route adds about twenty minutes.",
      reactions: [{ emoji: "👍", count: 2 }],
    },
  ],
  maya: [
    {
      id: "d1",
      author: "Maya Chen",
      time: "Yesterday",
      text: "Thanks for organizing dinner! Let me know if you need a hand.",
      reactions: [],
    },
  ],
  leo: [],
  home: [],
  bookclub: [
    {
      id: "b1",
      author: "Nora",
      time: "4:20 PM",
      day: "Today, September 30",
      text: "Next month’s book is picked. Bring your favorite passage to the next meetup.",
      reactions: [{ emoji: "📚", count: 4 }],
    },
  ],
};
export function filterItems(items: Item[], filter: Filter, query: string, sort: string) {
  return items
    .filter(
      (i) =>
        (filter === "Yours"
          ? i.creator === "You"
          : filter === "Favorites"
            ? i.favorite
            : i.priority !== undefined) &&
        i.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      filter === "Suggested" && a.priority !== b.priority
        ? (a.priority ?? 9) - (b.priority ?? 9)
        : sort === "name"
          ? a.title.localeCompare(b.title)
          : b.updated.localeCompare(a.updated),
    );
}
