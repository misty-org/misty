export function classToken(body: string): RegExp {
  return new RegExp(
    `(?<=["'\`\\s{])(?:[a-z0-9-]+(?:-\\[[^\\]\\s"'\`]+\\])?(?:\\/[\\w-]+)?:|\\[[^\\]\\s"'\`]+\\]:)*!?(?:${body})(?=["'\`\\s}])`,
    "g",
  );
}
