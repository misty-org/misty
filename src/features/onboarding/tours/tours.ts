import type { TourStep } from "@/shared/ui";
import { utilityTours } from "./utilityTours";

/**
 * Misty's guided tours, written for someone who has never used AI: what each thing is for, in
 * plain words, never how it works inside. A step points at the element tagged with its
 * `data-tour` name and is skipped when that element isn't on screen.
 */
export type TourId =
  | "welcome"
  | "agents"
  | "space"
  | "lab"
  | "notebook"
  | "space-chat"
  | "docs"
  | "doc"
  | "slides"
  | "deck"
  | "data"
  | "workbook"
  | "whiteboards"
  | "drawing"
  | "library"
  | "planner"
  | "calendar"
  | "search"
  | "layout"
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
        body: "Places you unpinned wait in here. Your agents and their engines are in Settings.",
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
        body: "Start a doc or a whiteboard that everyone here can edit at the same time.",
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
        body: "Share a notebook with your space. Friends can read it, add their own notes at the end and save a copy to their own lab.",
      },
    ],
  },
  notebook: {
    label: "Notebook tour",
    steps: [
      {
        target: "notebook-sources",
        title: "Your sources",
        body: "The files, links and notes this notebook learns from. Tick the ones you want it to use.",
      },
      {
        target: "notebook-add",
        title: "Add more",
        body: "Add a file, a link or a note of your own.",
      },
      {
        target: "notebook-ask",
        title: "Ask about them",
        body: "Ask a question. Answers point to where in your sources they came from.",
      },
      {
        target: "notebook-create",
        title: "Make something to study",
        body: "Turn the notebook into a summary, a mind map, flashcards, a quiz or something to listen to.",
      },
      {
        target: "notebook-share",
        title: "Work on it together",
        body: "Everyone in this Space can open this notebook. See who's here, talk it over, or change how it looks and behaves.",
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
        target: "space-chat-dms",
        title: "Direct messages",
        body: "Talk one to one with someone in this space.",
      },
      {
        target: "space-chat-composer",
        title: "Say something",
        body: "Write to everyone here and press return to send. Add files or things from Media too.",
      },
      {
        target: "space-chat-mention",
        title: "Call someone in",
        body: "Type @ to bring in a person, or to ask an agent to do something.",
      },
    ],
  },
  docs: {
    label: "Docs tour",
    steps: [
      {
        target: "space-make",
        title: "Make a doc",
        body: "Start a doc that everyone here can write in together.",
      },
      {
        target: "space-search",
        title: "Find one",
        body: "Search by a doc's name or the words inside it.",
      },
      {
        target: "space-filters",
        title: "Choose what you see",
        body: "Show everyone's docs or only yours, as pictures or as a list.",
      },
    ],
  },
  doc: {
    label: "Doc tour",
    steps: [
      {
        target: "doc-title",
        title: "Name it",
        body: "Give your doc a name everyone will recognize.",
      },
      {
        target: "doc-toolbar",
        title: "Make it look right",
        body: "Headings, lists, bold, pictures and more.",
      },
      {
        target: "doc-canvas",
        title: "Write together",
        body: "Everyone here can write at the same time. Select some text to ask Misty to change it.",
      },
      {
        target: "doc-backlinks",
        title: "Linked docs",
        body: "See which docs link here. Type [[ to link to another doc.",
      },
    ],
  },
  slides: {
    label: "Slides tour",
    steps: [
      {
        target: "space-make",
        title: "Make slides",
        body: "Start a deck, or ask your agent to turn a doc into one.",
      },
      {
        target: "space-search",
        title: "Find one",
        body: "Search by a deck's name or the words on its slides.",
      },
      {
        target: "space-filters",
        title: "Choose what you see",
        body: "Show everyone's decks or only yours, as pictures or as a list.",
      },
    ],
  },
  deck: {
    label: "Deck tour",
    steps: [
      {
        target: "deck-rail",
        title: "Your slides",
        body: "Drag a slide to move it. Right-click one to copy, hide or delete it.",
      },
      {
        target: "deck-layout",
        title: "Pick a layout",
        body: "Each slide is laid out for you. Change the layout and the words move with it.",
      },
      {
        target: "deck-theme",
        title: "Pick a look",
        body: "A theme sets the colors and fonts of every slide at once.",
      },
      {
        target: "deck-present",
        title: "Present",
        body: "Show your slides full screen, with your notes on your own screen.",
      },
    ],
  },
  data: {
    label: "Data tour",
    steps: [
      {
        target: "space-make",
        title: "Make a workbook",
        body: "Start one, or drop in a spreadsheet file to bring its sheets in.",
      },
      {
        target: "space-search",
        title: "Find one",
        body: "Search by a workbook's name or the words in its cells.",
      },
      {
        target: "space-filters",
        title: "Choose what you see",
        body: "Show everyone's workbooks or only yours, as pictures or as a list.",
      },
    ],
  },
  workbook: {
    label: "Workbook tour",
    steps: [
      {
        target: "workbook-grid",
        title: "Your sheet",
        body: "Type in any cell. Start with = to work something out, like =SUM(B2:B9).",
      },
      {
        target: "workbook-sheets",
        title: "More sheets",
        body: "Keep related tables side by side as sheets of one workbook.",
      },
      {
        target: "workbook-charts",
        title: "Charts",
        body: "Select some cells to chart them, then pin charts to the dashboard.",
      },
    ],
  },
  whiteboards: {
    label: "Whiteboards tour",
    steps: [
      {
        target: "space-make",
        title: "Make a whiteboard",
        body: "Start a board everyone here can draw on together.",
      },
      {
        target: "space-search",
        title: "Find one",
        body: "Search by a whiteboard's name or the words on it.",
      },
      {
        target: "space-filters",
        title: "Choose what you see",
        body: "Show everyone's whiteboards or only yours, as pictures or as a list.",
      },
    ],
  },
  drawing: {
    label: "Whiteboard tour",
    steps: [
      {
        target: "drawing-title",
        title: "Name it",
        body: "Give your whiteboard a name everyone will recognize.",
      },
      {
        target: "drawing-canvas",
        title: "Draw together",
        body: "Draw, add shapes and text, and paste pictures. Everyone here sees changes as they happen.",
      },
    ],
  },
  library: {
    label: "Media tour",
    steps: [
      {
        target: "library-upload",
        title: "Add files",
        body: "Files you upload here are shared with everyone in this space and their agents.",
      },
      {
        target: "library-search",
        title: "Find a file",
        body: "Search by a file's name.",
      },
      {
        target: "library-filters",
        title: "Sort and filter",
        body: "Narrow by type, change the order, see deleted files, or switch between pictures and a list.",
      },
    ],
  },
  planner: {
    label: "Planner tour",
    steps: [
      {
        target: "planner-new",
        title: "Add a task",
        body: "Write down something to do and choose who does it, a person or an agent.",
      },
      {
        target: "planner-board",
        title: "Move it along",
        body: "To do, in progress, done. Drag a card to the next column as work moves on.",
      },
      {
        target: "planner-search",
        title: "Find a task",
        body: "Search every task in this space.",
      },
    ],
  },
  calendar: {
    label: "Calendar tour",
    steps: [
      {
        target: "calendar-new",
        title: "Add an event",
        body: "Add a meeting or a date everyone in this space can see.",
      },
      {
        target: "calendar-grid",
        title: "Your month",
        body: "Tasks with dates and your events show here. Click a day to add something to it.",
      },
      {
        target: "calendar-months",
        title: "Move through time",
        body: "Go to another month, or jump back to today.",
      },
      {
        target: "calendar-view",
        title: "Month or list",
        body: "See the whole month, or a list of what's coming up.",
      },
    ],
  },
  ...utilityTours,
};
