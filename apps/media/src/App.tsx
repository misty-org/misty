import { MistyError } from "@misty/sdk";
import type { FileRef } from "@misty/sdk";
import { useFiles, useMisty } from "@misty/sdk-react";
import { useRef, useState } from "react";
import { kindText, sizeText } from "./format";

/** The most one file may be, for this app: it carries the bytes over the channel. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function describe(error: unknown): string {
  if (error instanceof MistyError && error.code === "permission_denied")
    return "Media isn't allowed to do that in this Space.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function App() {
  const misty = useMisty();
  const files = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const run = async (work: () => Promise<unknown>) => {
    setError("");
    try {
      await work();
    } catch (reason) {
      setError(describe(reason));
    }
  };

  const upload = async (chosen: FileList | null) => {
    if (!chosen?.length) return;
    setAdding(true);
    await run(async () => {
      for (const file of Array.from(chosen)) {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than ${sizeText(MAX_UPLOAD_BYTES)}.`);
        await misty.files.upload({ name: file.name, mime: file.type || "application/octet-stream", data: file });
      }
      files.reload();
    });
    setAdding(false);
    if (input.current) input.current.value = "";
  };

  const tile = (file: FileRef) => (
    <li key={file.id} className="card">
      <p className="card-title">{file.name}</p>
      <p className="card-meta">
        {kindText(file.mime, file.name)} · {sizeText(file.size)}
      </p>
      <div className="card-actions">
        <button type="button" onClick={() => void run(() => misty.files.open(file.id))}>
          Open
        </button>
      </div>
    </li>
  );

  return (
    <main className="planner">
      <header className="bar">
        <h1>Media</h1>
        <div className="add">
          <input ref={input} type="file" multiple hidden onChange={(event) => void upload(event.target.files)} />
          <button type="button" className="primary" disabled={adding} onClick={() => input.current?.click()}>
            Add files
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {files.error && !files.value ? (
        <p role="alert" className="note">
          Files couldn't load. {files.error.message}
        </p>
      ) : files.loading && !files.value ? (
        <ul className="grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className="skeleton" />
          ))}
        </ul>
      ) : files.value?.length ? (
        <ul className="grid">{files.value.map(tile)}</ul>
      ) : (
        <p className="note">No files yet. Add photos, videos and other files to share them with the Space.</p>
      )}
    </main>
  );
}
