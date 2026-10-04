// Synthetic content for the "Website launch" example project. Every name,
// address, file and message is invented; `.example` domains are reserved.

export const people = {
  alex: { id: "alex", name: "Alex Rivera", short: "Alex", initials: "AR" },
  sam: { id: "sam", name: "Sam Park", short: "Sam", initials: "SP" },
  priya: { id: "priya", name: "Priya Shah", short: "Priya", initials: "PS" },
  jo: { id: "jo", name: "Jo Tanaka", short: "Jo", initials: "JT" },
} as const;
export type PersonId = keyof typeof people;

export const devices = {
  desktop: "Office desktop",
  laptop: "Laptop",
  /** Paired for Files over the local network; not part of workspace sync. */
  studio: "Studio computer",
};

export type SiteId = "staging" | "checklist" | "images" | "cms";
export const sites: Record<SiteId, { title: string; host: string; path: string; mark: string }> = {
  staging: { title: "Fernway — Staging", host: "staging.fernway.example", path: "/", mark: "F" },
  checklist: { title: "Pre-launch website checklist", host: "webguide.example", path: "/launch-checklist", mark: "W" },
  images: { title: "Responsive image sizes", host: "imagenotes.example", path: "/sizes", mark: "I" },
  cms: { title: "Fernway CMS — Sign in", host: "cms.fernway.example", path: "/login", mark: "C" },
};

export const groupName = "Launch research";

export const spaces = {
  personal: { id: "personal", name: "Personal", initials: "P", members: 1 },
  team: { id: "team", name: "Website launch", initials: "WL", members: 4 },
};

export const brief = {
  title: "Launch brief",
  meta: "Personal · Journal · Edited Oct 2",
  goal: "Publish the new Fernway website with approved copy, final images, and a working contact form.",
  pages: ["Homepage", "Product overview", "Getting started", "Contact"],
  requirements: [
    "Final homepage copy reviewed by Sam",
    "Hero and product images exported at 1x and 2x",
    "Contact form tested on desktop and mobile",
    "Redirects from the old site mapped",
  ],
  date: "Launch review: Thursday, Oct 9",
};

export const personalTasks = [
  { title: "Draft homepage copy", status: "In progress", due: "Oct 3" },
  { title: "Export hero images", status: "To do", due: "Oct 6" },
  { title: "Test contact form", status: "To do", due: "Oct 7" },
  { title: "Map redirects from the old site", status: "To do", due: "Oct 8" },
  { title: "Collect brand assets", status: "Completed", due: "Sep 30" },
];

export const libraryItems = [
  { title: "Brand guidelines.pdf", type: "PDF", kind: "doc" },
  { title: "Homepage wireframe.png", type: "PNG", kind: "wireframe" },
  { title: "Hero photo.jpg", type: "JPG", kind: "photo" },
  { title: "Sitemap.md", type: "MD", kind: "doc" },
] as const;

export const chat = [
  { who: "sam", time: "10:12 AM", text: "I finished a pass on the homepage copy. It’s in the shared Journal." },
  { who: "priya", time: "10:14 AM", text: "Product images are uploading to the Library now." },
  { who: "jo", time: "10:21 AM", text: "Can someone own the hero image export before Thursday?" },
] as const;

export const sharedNote = {
  title: "Homepage copy",
  meta: "Website launch · Journal · Shared with 4 members",
  lines: [
    { kind: "h2", text: "Hero" },
    { kind: "p", text: "Fernway Paper Co. Notebooks, planners, and refills made in Portland." },
    { kind: "h2", text: "Product overview" },
    { kind: "p", text: "Three notebook sizes, two paper weights, and refills for every cover." },
    { kind: "h2", text: "Call to action" },
  ],
  addition: "Browse notebooks, or start with a sample pack.",
};

export const teamTasks = [
  { title: "Review homepage copy", status: "In progress", who: "alex" },
  { title: "Export hero images", status: "To do", who: null },
  { title: "Upload product photos", status: "In progress", who: "priya" },
  { title: "Map redirects from the old site", status: "To do", who: "jo" },
] as const;

export const studioFiles = [
  { name: "hero-photo.jpg", size: "8.4 MB", kind: "Image", modified: "Today, 9:41 AM" },
  { name: "logo.svg", size: "12 KB", kind: "SVG image", modified: "Sep 30" },
  { name: "product-notebooks.jpg", size: "6.1 MB", kind: "Image", modified: "Today, 9:38 AM" },
  { name: "wireframe-homepage.png", size: "2.2 MB", kind: "Image", modified: "Sep 29" },
];

export const agentRequest = "Turn the launch brief into a checklist.";
export const agentChecklist = {
  intro: "Here is a checklist from Launch brief:",
  groups: [
    {
      title: "Before launch",
      items: [
        "Review final homepage copy with Sam",
        "Export hero and product images at 1x and 2x",
        "Test the contact form on desktop and mobile",
        "Map redirects from the old site",
      ],
    },
    { title: "Launch day", items: ["Publish the site and check every page", "Confirm the contact form delivers"] },
  ],
};

export const contactDraft = "Testing the contact form before launch.";
