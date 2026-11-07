// Served by the app's Vite to its own window, so it shares the app's copy of the editor. A Space's note page
// needs the note collaboration Worker, which a throwaway server doesn't have, so the proposal step gives the
// app's real note adapter a real editor, with the words selected the way a person would.
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

export function openNoteEditor(text) {
  const element = document.createElement("div");
  element.style.cssText = "position:fixed;left:-4000px;top:0;width:400px";
  document.body.appendChild(element);
  const editor = new Editor({ element, extensions: [StarterKit], content: `<p>${text}</p>` });
  editor.commands.setTextSelection({ from: 1, to: text.length + 1 });
  return { editor, element };
}
