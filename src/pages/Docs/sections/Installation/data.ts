import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "installation",
  label: "Installation",
  category: "getting-started",
  title: "Installation",
  prose: "Getting started takes a few minutes. Download Misty, install it, create a free account, and connect your first cloud provider.",
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
    {
      kind: "tip",
      text: "Install first, then connect one provider before changing too many settings at once.",
    },
  ],
};
