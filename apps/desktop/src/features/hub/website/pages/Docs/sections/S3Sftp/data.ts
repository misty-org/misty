import type { SectionData } from "../../types";

export const data: SectionData = {
  id: "s3-sftp",
  label: "Connecting S3 and Sftp",
  category: "providers",
  title: "Connecting S3 and Sftp",
  prose: `S3 and Sftp are a better fit when your files live closer to servers, backups, or infrastructure than to consumer cloud drives.

These providers usually take a little more setup, but they give you direct access to storage you already control.

This is where Misty starts to feel less like a cloud browser and more like an operations tool.`,
  notes: [
    {
      kind: "tip",
      text: "Connect one bucket or host first before importing everything. It makes path and permission checks much easier.",
    },
  ],
};
