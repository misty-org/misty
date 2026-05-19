import { Section } from "./data";

export const guideSections: Section[] = [
  {
    id: "introduction",
    label: "Overview",
    category: "getting-started",
    title: "Getting started",
    prose: [
      "Misty is a file manager that brings your local and cloud storage into one native app. Instead of jumping between browser tabs and separate tools, you can browse, move, and manage everything in one place.",
      "At its core, Misty uses a local proxy that connects directly to multiple cloud providers. That proxy runs on your machine, and your data never passes through a Misty server.",
      "Alongside file management, Misty includes a plugin system for custom workflows, encrypted Vault backups powered by restic, a Gemini-powered AI assistant that understands your files, and Tailscale support for secure remote access.",
      "The desktop client is built with C++ and ImGui for a fast native experience. The local proxy communicates with the app over HTTP on localhost, so everything stays on your machine."
    ],
    notes: [
      { kind: "tip", text: "Start with one provider first, make sure search and transfers feel right, then add the rest of your setup." },
    ],
  },
  {
    id: "installation",
    label: "Installation",
    category: "getting-started",
    title: "Installation",
    prose: [
      "Getting started takes a few minutes. Download Misty, install it, create a free account, and connect your first cloud provider.",
    ],
    steps: [
      {
        heading: "Download Misty",
        text: "Head to the download page and grab the latest release for your platform. Misty is available for Windows, macOS, and Linux.",
      },
      {
        heading: "Install",
        text: "Windows lets you run the installer and follow the prompts. On macOS, open the dmg and drag Misty into Applications. On Linux, use the AppImage or package that matches your setup.",
      },
      {
        heading: "Launch Misty",
        text: "Open Misty and let the local proxy start in the background. On first launch, you will be taken to the sign in screen.",
        screenshot: null,
      },
    ],
    notes: [
      { kind: "tip", text: "Install first, then connect one provider before changing too many settings at once." },
    ],
  },
  {
    id: "setup",
    label: "Setup",
    category: "getting-started",
    title: "Setup",
    prose: [
      "After installation, the fastest path is to sign in, connect one provider, and let Misty build its first index in the background.",
      "You can expand later into multiple providers, backups, plugins, or remote access workflows without having to redo the initial setup.",
      "If you are migrating from another workflow, start small and verify the basics first.",
    ],
    notes: [
      { kind: "tip", text: "Confirm browsing, uploads, and search feel right with one provider before adding the rest of your storage." },
    ],
  },
  {
    id: "providers-overview",
    label: "Connecting accounts",
    category: "providers",
    title: "Connecting accounts",
    prose: [
      "Misty is designed to make different storage providers feel consistent. You can browse, search, upload, and organize files from one interface even when the providers themselves work very differently.",
      "Google Drive and OneDrive are usually the easiest places to begin. S3 and Sftp are a better fit when your files live closer to servers, backups, or infrastructure workflows.",
      "You do not need to connect every provider at once. Start with the one you already rely on most, then expand once the flow feels good.",
    ],
    notes: [
      { kind: "tip", text: "If you are new to Misty, connect a familiar provider first so you can validate search, previews, and transfers before expanding." },
    ],
  },
  {
    id: "google-drive",
    label: "Configuring Google Drive",
    category: "providers",
    title: "Configuring Google Drive",
    prose: [
      "Google Drive is usually the easiest provider to start with because the auth flow is familiar and shared folders are common.",
      "It is a good choice when you want to validate that search, previews, and transfers all feel solid before expanding into more complex setups.",
      "If you rely on shared drives, connect a personal account first, then expand into workspace resources once your baseline feels stable.",
    ],
    notes: [
      { kind: "tip", text: "Use Google Drive as your first provider if you want the smoothest initial setup." },
    ],
  },
  {
    id: "onedrive",
    label: "Configuring OneDrive",
    category: "providers",
    title: "Configuring OneDrive",
    prose: [
      "OneDrive works well for Microsoft heavy workflows where documents, team folders, and Office collaboration matter most.",
      "Misty keeps that structure readable while giving you the same browsing and search flow you get with every other provider.",
      "If you use both personal and work accounts, connect them one at a time so it stays obvious which libraries you want visible.",
    ],
    notes: [
      { kind: "note", text: "Some organization managed accounts may require an approval step before the provider appears fully." },
    ],
  },
  {
    id: "s3-sftp",
    label: "Connecting S3 and Sftp",
    category: "providers",
    title: "Connecting S3 and Sftp",
    prose: [
      "S3 and Sftp are a better fit when your files live closer to servers, backups, or infrastructure than to consumer cloud drives.",
      "These providers usually take a little more setup, but they give you direct access to storage you already control.",
      "This is where Misty starts to feel less like a cloud browser and more like an operations tool.",
    ],
    notes: [
      { kind: "tip", text: "Connect one bucket or host first before importing everything. It makes path and permission checks much easier." },
    ],
  },
  {
    id: "backups-overview",
    label: "Creating backups",
    category: "backups",
    title: "Creating backups",
    prose: [
      "Backups in Misty are built around Vault, which uses restic under the hood to create encrypted snapshots of local or remote folders.",
      "The goal is to make backups feel like part of the same file workflow instead of a separate tool. You can create snapshots, restore older versions, and manage backup targets without leaving the app.",
      "A good starting point is backing up one important folder first. Once you trust the flow, you can expand into broader backup jobs and longer retention strategies.",
    ],
    notes: [
      { kind: "tip", text: "Test a restore early. A backup system feels much more trustworthy once you have verified that restores work the way you expect." },
    ],
  },
  {
    id: "snapshots",
    label: "Reviewing snapshots",
    category: "backups",
    title: "Reviewing snapshots",
    prose: [
      "Snapshots are the core unit of a backup in Misty. Each one captures a point in time that you can return to later.",
      "This is useful for version recovery, accidental deletes, or simply having a reliable checkpoint before you make large changes.",
      "The best way to trust snapshots is to create one early and make sure you understand how it appears in the app.",
    ],
    notes: [],
  },
  {
    id: "restore",
    label: "Restoring files",
    category: "backups",
    title: "Restoring files",
    prose: [
      "A restore flow matters more than the backup itself. Misty is designed to make it easy to browse older points in time and bring files back without leaving the app.",
      "For important workflows, test restores early instead of waiting for a stressful moment to learn how the process works.",
      "Once you know restores behave the way you expect, the backup system becomes much more trustworthy.",
    ],
    notes: [
      { kind: "tip", text: "Always test at least one restore before you rely on any backup setup long term." },
    ],
  },
  {
    id: "search-overview",
    label: "Searching across files",
    category: "search",
    title: "Searching across files",
    prose: [
      "Search is one of Misty's core strengths. Instead of checking each provider separately, you can ask one question and search across all the storage you have connected.",
      "That makes Misty useful even before you move many files around. For a lot of people, the first big win is simply finding the right file without remembering which provider it lives in.",
      "Once your first index is built, search becomes the quickest way to validate that your setup is working the way it should.",
    ],
    notes: [
      { kind: "tip", text: "A single connected provider is enough to test the search experience. You can scale up once you are happy with the results." },
    ],
  },
  {
    id: "indexing",
    label: "Managing indexing",
    category: "search",
    title: "Managing indexing",
    prose: [
      "Indexing is what makes search feel fast instead of repetitive. Misty builds that index in the background so you are not waiting on every query.",
      "The first index is usually the moment search starts to feel powerful because your connected storage becomes easier to treat like one system.",
      "You do not need a huge setup to benefit from indexing. Even one provider is enough to feel the difference.",
    ],
    notes: [],
  },
  {
    id: "search-workflows",
    label: "Working from results",
    category: "search",
    title: "Working from results",
    prose: [
      "Search becomes most useful when it is part of a larger workflow. Find a file, preview it, move it, back it up, or hand it off to a plugin without switching tools.",
      "That makes Misty less about isolated lookup and more about moving quickly from question to action.",
      "The more providers you connect, the more valuable these cross storage workflows become.",
    ],
    notes: [],
  },
  {
    id: "plugins-overview",
    label: "Installing plugins",
    category: "plugins",
    title: "Installing plugins",
    prose: [
      "Plugins let you extend Misty beyond basic file browsing. The idea is to make custom workflows feel native to the app instead of forcing everything through one fixed interface.",
      "That can mean automation, internal tools, custom panels, or workflows that tie together cloud storage, local files, and your own systems.",
      "The plugin system is meant to keep Misty flexible. You can start simple, then gradually shape the app around the way you actually work.",
    ],
    notes: [
      { kind: "note", text: "A good plugin usually solves one clear workflow first. It is better to start narrow and useful than broad and vague." },
    ],
  },
  {
    id: "building-plugins",
    label: "Building plugins",
    category: "plugins",
    title: "Building plugins",
    prose: [
      "A strong plugin usually starts with one clear workflow. It does not need to solve everything at once.",
      "The best way to build for Misty is to begin with a narrow use case that already matters to you, then grow from there as the workflow proves itself.",
      "That keeps plugins useful, understandable, and easier to maintain over time.",
    ],
    notes: [
      { kind: "note", text: "Start small and useful. A focused plugin almost always lands better than a broad one." },
    ],
  },
  {
    id: "mistyai-overview",
    label: "Asking MistyAI",
    category: "mistyai",
    title: "Asking MistyAI",
    prose: [
      "MistyAI adds a conversational layer on top of your files so you can ask questions, find content faster, and trigger actions without manually digging through folders.",
      "The value is not just chat for the sake of chat. It is about understanding your working directory, your connected storage, and the context around the files you already manage in Misty.",
      "For many workflows, MistyAI becomes the quickest way to move from a vague question to a concrete action.",
    ],
    notes: [
      { kind: "tip", text: "Try using MistyAI for discovery first. Asking it to find, summarize, or narrow down files is often the fastest way to build trust in the workflow." },
    ],
  },
  {
    id: "ask-mistyai",
    label: "Refining context",
    category: "mistyai",
    title: "Refining context",
    prose: [
      "MistyAI works best when you use it for discovery first. Ask it to find, narrow down, or summarize files before jumping into more complex actions.",
      "That gives you a quick sense of how well it understands your storage and how naturally it fits into your workflow.",
      "Once that trust is there, it becomes much easier to use MistyAI as a real working tool instead of a novelty.",
    ],
    notes: [],
  },
  {
    id: "mistyai-actions",
    label: "Taking actions",
    category: "mistyai",
    title: "Taking actions",
    prose: [
      "The real value of MistyAI is moving from a vague request to a concrete action. Find a file, identify the right folder, and then act on it without losing context.",
      "That can mean opening, organizing, or preparing files for the next step in your workflow.",
      "MistyAI is strongest when it shortens the distance between knowing what you need and actually doing something useful with your files.",
    ],
    notes: [
      { kind: "tip", text: "Start with small tasks first. It is the quickest way to understand where MistyAI is most helpful for your workflow." },
    ],
  },
];
