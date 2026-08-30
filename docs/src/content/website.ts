import type { DocPage } from "./types";
import { code, p, table } from "./types";

export const websitePages: DocPage[] = [
  {
    path: "/website",
    title: "misty website",
    eyebrow: "Website",
    description: "Run the public Misty website from its repository.",
    sections: [
      {
        id: "commands",
        title: "Commands",
        blocks: [
          table(
            ["Command", "Purpose"],
            [["website dev", "Start Vite development."]],
          ),
        ],
      },
    ],
  },
  {
    path: "/website/dev",
    title: "misty website dev",
    eyebrow: "Website",
    description: "Start the public website development server.",
    command: "misty website dev",
    sections: [
      {
        id: "usage",
        title: "Usage",
        blocks: [
          code("misty website dev"),
          p(
            "The command validates the sibling repositories, runs misty-website’s dev script, and leaves Vite running until you press Control+C.",
          ),
        ],
      },
    ],
  },
];
