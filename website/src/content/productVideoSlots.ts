export type ProductVideoSlotId =
  | "choose-apps"
  | "workspace-layouts"
  | "agent-workflows"
  | "share-space";

export type ProductVideoSlot = {
  filename: string;
  src?: string;
  label: string;
  desiredState: string;
};

/**
 * Add each finished recording to `public/videos`, then set its `src` here.
 * Until then, the scroll story renders its existing product preview.
 */
export const productVideoSlots: Record<ProductVideoSlotId, ProductVideoSlot> = {
  "choose-apps": {
    filename: "misty-choose-apps.mp4",
    label: "Adding apps to the Misty navigation",
    desiredState:
      "Open the new-app menu and add several apps to the navigation in quick succession.",
  },
  "workspace-layouts": {
    filename: "misty-workspace-layouts.mp4",
    label: "Building and switching between flexible workspace layouts",
    desiredState:
      "Switch rapidly between tabs, then arrange multiple apps into windows and panels.",
  },
  "agent-workflows": {
    filename: "misty-agent-workflows.mp4",
    label: "Asking a Misty Agent to manage a workflow",
    desiredState:
      "Ask Misty to manage an automation or workflow and show the successful result.",
  },
  "share-space": {
    filename: "misty-share-space.mp4",
    label: "Sharing a Misty Space with other people",
    desiredState:
      "Invite another person and show that the Space, apps, files, and context are ready to share.",
  },
};
