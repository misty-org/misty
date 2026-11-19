import { PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import { mistyEditorTheme } from "@/shared/lib/codemirror/mistyTheme";
import type { DbKind, DbSchema } from "./dbApi";
import { completionSchema, defaultSchema } from "./sqlText";

const BASIC_SETUP = { foldGutter: false, highlightActiveLine: true };

/**
 * A query's text in CodeMirror, in the connection's own SQL dialect, completing the schemas,
 * tables and columns its schema lists. ⌘↵ runs it.
 */
export function SqlEditor(props: {
  value: string;
  kind: DbKind;
  schema: DbSchema | null;
  onChange(value: string): void;
  onRun(): void;
}) {
  // The keymap is built once, yet always runs the latest query.
  const runRef = useRef(props.onRun);
  useEffect(() => {
    runRef.current = props.onRun;
  });
  const runKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
    [],
  );
  const language = useMemo(
    () =>
      sql({
        dialect: props.kind === "postgres" ? PostgreSQL : SQLite,
        schema: props.schema ? completionSchema(props.schema) : undefined,
        defaultSchema: defaultSchema(props.kind),
      }),
    [props.kind, props.schema],
  );
  const extensions = useMemo(() => [mistyEditorTheme, runKeymap, language], [runKeymap, language]);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 [&_.cm-editor]:h-full">
      <CodeMirror
        className="min-h-0 flex-1 overflow-hidden"
        height="100%"
        value={props.value}
        theme="none"
        onChange={props.onChange}
        extensions={extensions}
        basicSetup={BASIC_SETUP}
      />
    </div>
  );
}
