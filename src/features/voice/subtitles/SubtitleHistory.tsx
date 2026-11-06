import { Download, Trash2 } from "lucide-react";
import { Checkbox, IconButton } from "@/shared/ui";
import type { SubtitlesAction, SubtitlesView } from "./subtitlesView";

/** Sessions kept on this computer, when Save sessions is on. */
export function SubtitleHistory(props: {
  view: SubtitlesView;
  act: (action: SubtitlesAction) => void;
}) {
  const { view, act } = props;
  return (
    <section className="subtitle-history" aria-label="Saved history">
      <label className="subtitle-save">
        <Checkbox
          checked={view.prefs.save}
          disabled={view.status !== "idle"}
          onCheckedChange={(save) => act({ type: "prefs", patch: { save: save === true } })}
        />
        <span>Save sessions on this computer</span>
      </label>
      {view.history.length ? (
        view.history.map((row) => (
          <article key={row.id} className="subtitle-history-row">
            <div className="subtitle-history-copy">
              <strong>{new Date(row.startedAt).toLocaleString()}</strong>
              <p>{row.preview}</p>
            </div>
            <IconButton label="Export text" onClick={() => act({ type: "export", id: row.id })}>
              <Download size={14} aria-hidden />
            </IconButton>
            <IconButton label="Delete session" onClick={() => act({ type: "delete", id: row.id })}>
              <Trash2 size={14} aria-hidden />
            </IconButton>
          </article>
        ))
      ) : (
        <p className="subtitle-history-empty">No saved sessions yet.</p>
      )}
    </section>
  );
}
