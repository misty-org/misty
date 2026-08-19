import { Compartment, type Extension } from "@codemirror/state";
import { lineNumbers, EditorView } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import type { EditorPreferences } from "@/features/settings";
import { createEditorTypographyTheme, resolveEditorTheme } from "./codeMirrorTheme";

export interface EditorCompartments {
  lineNumbersCompartment: Compartment;
  tabSizeCompartment: Compartment;
  wordWrapCompartment: Compartment;
  typographyCompartment: Compartment;
  themeCompartment: Compartment;
}

export function createEditorCompartments(): EditorCompartments {
  return {
    lineNumbersCompartment: new Compartment(),
    tabSizeCompartment: new Compartment(),
    wordWrapCompartment: new Compartment(),
    typographyCompartment: new Compartment(),
    themeCompartment: new Compartment(),
  };
}

export function buildConfigurableExtensions(
  compartments: EditorCompartments,
  preferences: EditorPreferences,
): Extension[] {
  return [
    compartments.themeCompartment.of(resolveEditorTheme(preferences.theme)),
    compartments.lineNumbersCompartment.of(preferences.lineNumbers ? lineNumbers() : []),
    compartments.tabSizeCompartment.of(indentUnit.of(" ".repeat(preferences.tabSize))),
    compartments.wordWrapCompartment.of(preferences.wordWrap ? EditorView.lineWrapping : []),
    compartments.typographyCompartment.of(
      createEditorTypographyTheme(preferences.fontSize, preferences.fontFamily),
    ),
  ];
}

export function reconfigureEditorPreferences(
  view: EditorView,
  compartments: EditorCompartments,
  preferences: EditorPreferences,
): void {
  view.dispatch({
    effects: [
      compartments.themeCompartment.reconfigure(resolveEditorTheme(preferences.theme)),
      compartments.lineNumbersCompartment.reconfigure(preferences.lineNumbers ? lineNumbers() : []),
      compartments.tabSizeCompartment.reconfigure(indentUnit.of(" ".repeat(preferences.tabSize))),
      compartments.wordWrapCompartment.reconfigure(
        preferences.wordWrap ? EditorView.lineWrapping : [],
      ),
      compartments.typographyCompartment.reconfigure(
        createEditorTypographyTheme(preferences.fontSize, preferences.fontFamily),
      ),
    ],
  });
}
