import type { TourStep } from "@misty/ui";
import { utilityTours } from "./utility_tours";

export type TourId =
  | "welcome"
  | "agents"
  | "space"
  | "space-chat"
  | "search"
  | "add-sources"
  | "agent-settings";

export const tours: Record<TourId, { label: string; steps: readonly TourStep[] }> = {
  welcome: {
    label: "Welcome tour",
    steps: [
      {
        title: "Welcome to Misty",
        body: "Here's a quick look around. You can see this again any time from your account menu.",
      },
      {
        target: "sidebar-dms",
        title: "Start a chat",
        body: "Your agents are under Direct messages. Pick one to talk to it the way you'd text a friend; only you see these chats.",
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
        target: "composer-mode",
        title: "How it works",
        body: "Each engine has its own ways to work, from checking with you first to working without asking inside its folder. Pick one here.",
      },
      {
        target: "chat-panels",
        title: "Tools for this chat",
        body: "Start a fresh chat, follow the steps your AI is taking, and see the files it changed and the pages it opened.",
      },
      {
        target: "sidebar-space",
        title: "Your space",
        body: "Share docs, whiteboards and files with friends, and see what everyone's agents are working on.",
      },
      {
        target: "sidebar-search",
        title: "Search",
        body: "Find anything you've made, and any chat.",
      },
      {
        target: "sidebar-explore",
        title: "Explore",
        body: "Find agents and apps to add, and see the tools they can use.",
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
        body: "Choose the engine it runs on and give it a name. You can have a few on the same engine.",
      },
      {
        target: "settings-nav",
        title: "Set up their engines",
        body: "Engines and Tools, in the list on the left, install and update each engine, sign you in, and add plugins and more.",
      },
    ],
  },
  space: {
    label: "Space tour",
    steps: [
      {
        target: "sidebar-space",
        title: "Your space",
        body:
          "A shared place for a project, a class or friends. Its name opens the Space menu: " +
          "switch spaces, start one, see its people and its shared folders.",
      },
      {
        target: "sidebar-apps",
        title: "Apps",
        body: "Open-source apps this Space added open from here. A mod can add more from Explore.",
      },
      {
        target: "sidebar-space",
        title: "Invite friends",
        body:
          "If you made this space, invite people from its menu. " +
          "They see what you share and what your agents are doing, never your chats.",
      },
    ],
  },
  "space-chat": {
    label: "Chat tour",
    steps: [
      {
        target: "space-chat-channels",
        title: "Channels",
        body: 'Group chats for everyone in this space. Everyone is in "everyone".',
      },
      {
        target: "sidebar-dms",
        title: "Direct messages",
        body: "Talk one to one with someone in this space.",
      },
      {
        target: "space-chat-composer",
        title: "Say something",
        body: "Write to everyone here and press return to send. Add files or things from Files too.",
      },
      {
        target: "space-chat-mention",
        title: "Call someone in",
        body: "Type @ to bring in a person, or to ask an agent to do something.",
      },
    ],
  },
  ...utilityTours,
};
