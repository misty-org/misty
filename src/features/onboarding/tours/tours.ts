import type { TourStep } from "@/shared/ui";

/**
 * Misty's guided tours, written for someone who has never used AI: what each thing is for, in
 * plain words, never how it works inside. A step points at the element tagged with its
 * `data-tour` name and is skipped when that element isn't on screen.
 */
export type TourId = "welcome" | "agents" | "space" | "lab" | "studio" | "integrations";

export const tours: Record<TourId, { label: string; steps: readonly TourStep[] }> = {
  welcome: {
    label: "Welcome tour",
    steps: [
      {
        title: "Welcome to Misty",
        body: "Here's a quick look around. You can see this again any time from your account menu.",
      },
      {
        target: "sidebar-new",
        title: "Start a chat",
        body: "Talk to your AI here, the same way you'd text a friend.",
      },
      {
        target: "composer",
        title: "Ask anything",
        body: "It can write, plan and make things with you. Press return to send.",
      },
      {
        target: "composer-add",
        title: "Add a file or picture",
        body: "Drop in a file, a photo or a screenshot and ask about it.",
      },
      {
        target: "composer-permissions",
        title: "How much it does on its own",
        body: "It can check with you before changing anything, or just get on with everyday work.",
      },
      {
        target: "composer-mode",
        title: "Plan before it builds",
        body: "In plan mode it talks the steps through with you before it does anything.",
      },
      {
        target: "sidebar-agents",
        title: "Your agents",
        body: "Pick which AI you chat with, add another, and install or set up the apps they run on.",
      },
      {
        target: "sidebar-space",
        title: "Your space",
        body: "Share docs, drawings and files with friends, and see what everyone's agents are working on.",
      },
      {
        target: "sidebar-lab",
        title: "The lab",
        body: "Learn anything. Your AI finds sources, explains them and quizzes you.",
      },
      {
        target: "sidebar-search",
        title: "Search",
        body: "Find anything you've made, and any chat.",
      },
      {
        target: "sidebar-more",
        title: "More",
        body: "The studio, where your agents work at little desks, lives in here.",
      },
      {
        target: "account",
        title: "Need help?",
        body: "Your account menu has help and this tour.",
      },
    ],
  },
  agents: {
    label: "Agents tour",
    steps: [
      {
        target: "agents-list",
        title: "Your agents",
        body: "Each one is an AI you can chat with. Pick one to start a new chat; new chats keep using it.",
      },
      {
        target: "agents-new",
        title: "Add an agent",
        body: "Choose the app it runs on and give it a name. You can have a few on the same app.",
      },
      {
        title: "Set up their apps",
        body: "The list on the left installs and updates each app, signs you in, and sets its environment variables, plugins and more.",
      },
    ],
  },
  space: {
    label: "Space tour",
    steps: [
      {
        target: "space-switcher",
        title: "Your space",
        body: "A shared place for a project, a class or friends. Switch spaces or start a new one here.",
      },
      {
        target: "space-places",
        title: "Pages",
        body: "Chat with everyone here, write docs together, plan tasks and keep files.",
      },
      {
        target: "space-make",
        title: "Make something together",
        body: "Start a doc or a drawing that everyone here can edit at the same time.",
      },
      {
        target: "space-get-started",
        title: "Your first steps",
        body: "A few things to try. Each one checks itself off once you've done it.",
      },
      {
        target: "space-switcher",
        title: "Invite friends",
        body: "If you made this space, invite people from this menu. They see what you share and what your agents are doing, never your chats.",
      },
    ],
  },
  lab: {
    label: "Lab tour",
    steps: [
      {
        target: "lab-start",
        title: "What do you want to learn?",
        body: "Type a topic or pick one, and your AI finds good sources to start a notebook.",
      },
      {
        target: "lab-new",
        title: "Your notebooks",
        body: "Add your own files, links and notes, then ask questions. Answers show where they came from.",
      },
      {
        title: "Study tools",
        body: "Turn a notebook into a summary, a mind map, flashcards, a quiz or something to listen to.",
      },
      {
        title: "Learn together",
        body: "Share a notebook with your space. Friends can read it, add notes and save it to their own lab.",
      },
    ],
  },
  studio: {
    label: "Studio tour",
    steps: [
      {
        title: "Your studio",
        body: "Each agent has a desk here. They type while they work and wave at the door when they need you.",
      },
      {
        title: "Talk to them",
        body: "Click an agent to chat, or use the box at the bottom to give one task to a few of them at once.",
      },
      {
        title: "Friends drop by",
        body: "In a shared space, friends' agents visit while they have Misty open, so you can see what everyone's up to.",
      },
    ],
  },
  integrations: {
    label: "Integrations tour",
    steps: [
      {
        target: "integrations-tabs",
        title: "Give your AI more to work with",
        body: "Plugins add new skills. Apps let your AI use things like your notes once you sign in.",
      },
      {
        title: "You're in charge",
        body: "Your AI uses an app only after you've signed in to it, and you can sign out whenever you like.",
      },
    ],
  },
};
