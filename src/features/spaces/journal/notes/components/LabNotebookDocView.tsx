import { FlaskConical } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type * as Y from "yjs";
import { MistyMarkdown } from "@/features/agents";
import { Button, Surface } from "@/shared/ui";

/** Whether a doc is the Lab's (a notebook, or someone's questions about one): the Lab writes its
 * own types into it. */
export function useIsLabNotebook(doc: Y.Doc | undefined): boolean {
  const [labNotebook, setLabNotebook] = useState(() => isLabNotebook(doc));
  useEffect(() => {
    if (!doc) return;
    const metas = [doc.getMap("lab:meta"), doc.getMap("qa:meta")];
    const check = () => setLabNotebook(isLabNotebook(doc));
    check();
    metas.forEach((meta) => meta.observe(check));
    return () => metas.forEach((meta) => meta.unobserve(check));
  }, [doc]);
  return labNotebook;
}

const isLabNotebook = (doc: Y.Doc | undefined) =>
  doc?.getMap("lab:meta").get("schema") != null || doc?.getMap("qa:meta").get("ownerId") != null;

/**
 * A Lab notebook's doc as Spaces shows it: its readable copy, which the Lab keeps up to date, and
 * a way to the Lab, where everyone in the Space works in it. Its body is the Lab's to write, so
 * it isn't edited here.
 */
export function LabNotebookDocView({
  spaceId,
  noteId,
  markdown,
}: {
  spaceId: string;
  noteId: string;
  markdown: Y.Text;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState(() => markdown.toString());
  useEffect(() => {
    const update = () => setText(markdown.toString());
    update();
    markdown.observe(update);
    return () => markdown.unobserve(update);
  }, [markdown]);
  const open = () =>
    navigate(
      `/spaces/${encodeURIComponent(spaceId)}/lab?doc=${encodeURIComponent(
        // Someone's questions open their notebook.
        String(markdown.doc?.getMap("qa:meta").get("notebookDocId") ?? "") || noteId,
      )}`,
    );
  return (
    <Surface tone="none" className="mx-auto flex w-full max-w-180 flex-col gap-4 px-6 py-6">
      <div>
        <Button variant="quiet" icon={FlaskConical} onClick={open}>
          Open in Lab
        </Button>
      </div>
      <MistyMarkdown>{text}</MistyMarkdown>
    </Surface>
  );
}
