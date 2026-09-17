import type { OfficialApp } from "./api";

/** Keep older catalog responses consistent with Storage's current identity. */
export function officialAppPresentation(app: OfficialApp): OfficialApp {
  if (app.id !== "library") return app;
  return {
    ...app,
    name: "Storage",
    description:
      app.description === "Curated resources shared with a Space."
        ? "Connect and browse your personal cloud storage services."
        : app.description,
    about:
      app.about ===
      "Connect your personal library tools and use them with your agents. Shared Misty content lives in Spaces."
        ? "Connect your personal storage services and use them with your agents. Shared Misty content lives in Space Library."
        : app.about,
  };
}
