import type { NotebookSource } from "../tutorTypes";

/**
 * An answer as a note: its "[2]" citations become the sources' names (linked, for a link), since
 * a note is read by people who don't have the asker's numbering.
 */
export function answerForNotes(
  answer: string,
  numbered: readonly string[] | undefined,
  sources: readonly NotebookSource[],
): string {
  return answer.replace(/\[(\d{1,3})\](?!\()/g, (whole, number: string) => {
    const index = Number(number) - 1;
    const id = numbered ? numbered[index] : sources[index]?.id;
    const source = sources.find((item) => item.id === id);
    if (!source) return whole;
    const title = source.title.replace(/[[\]]/g, "");
    return source.url ? `[${title}](${source.url})` : `(${title})`;
  });
}

/** LaTeX written as \[ … \] or \( … \) becomes $$ … $$, which Misty's Markdown draws as math. */
export function mathMarkdown(text: string): string {
  return text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_whole, math: string) => `$$${math.trim()}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_whole, math: string) => `$$${math.trim()}$$`);
}

/**
 * "[2]" in an answer becomes a link that opens source 2; one already a link stays as it is. Given
 * the source ids in the order the question numbered them, it links the source itself, so the
 * number keeps pointing at it when others add or remove sources.
 */
export function citeLinks(answer: string, sources: number | readonly string[]): string {
  const count = typeof sources === "number" ? sources : sources.length;
  return mathMarkdown(answer).replace(/\[(\d{1,3})\](?!\()/g, (whole, number: string) => {
    const index = Number(number);
    if (index < 1 || index > count) return whole;
    return typeof sources === "number"
      ? `[[${index}]](#tutor-source-${index})`
      : `[[${index}]](#tutor-source-id-${sources[index - 1]})`;
  });
}
