/**
 * A Tailwind class token in a string: preceded by a quote, a space or a brace, followed by one of
 * those, with any variant prefixes (`hover:`, `md:`, `[&_svg]:`, `data-[state=open]:`,
 * `group-hover/row:`) and the `!` modifier. Prose and
 * function names (`truncate(text)`) don't match.
 */
export function classToken(body: string): RegExp {
  return new RegExp(
    `(?<=["'\`\\s{])(?:[a-z0-9-]+(?:-\\[[^\\]\\s"'\`]+\\])?(?:\\/[\\w-]+)?:|\\[[^\\]\\s"'\`]+\\]:)*!?(?:${body})(?=["'\`\\s}])`,
    "g",
  );
}
