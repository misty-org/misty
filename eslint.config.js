import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Architecture boundaries. See CLAUDE.md.
 *
 *   app  →  pages  →  features  →  services  →  shared
 *
 * A layer may import from layers to its right, never to its left. Features are
 * mutually opaque: they talk to each other through `index.ts` only.
 *
 * Architectural, state-safety, and readability rules are release-blocking.
 * The reset has no migration-warning baseline: every finding is an error.
 */
const REFACTOR = "error";

/** @param {Array<[string[], string]>} groups */
const restrict = (groups) => [
  REFACTOR,
  { patterns: groups.map(([group, message]) => ({ group, message })) },
];

const MODELS_BAN = [
  ["@/models", "@/models/*"],
  "src/models/ is being removed. Colocate types with their owner: component props in the component, feature types in features/<f>/types.ts, API DTOs in services/.",
];

const FEATURE_INTERNALS = [
  ["@/features/*/*"],
  "Import a feature through its index.ts (@/features/<name>), not its internals.",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "dist/**",
      "build/**",
      "src-tauri/**",
      // Tooling and scratch trees that are not application source.
      ".claude/**",
      ".codex/**",
      ".codex-qa/**",
      ".demo/**",
      ".design-sync/**",
      ".ds-sync/**",
      ".windows-test/**",
      ".zed/**",
      "ds-bundle/**",
      "artifacts/**",
      "backlog/**",
      "docs/**",
      "public/**",
      "scripts/**",
      "service/**",
      "*.config.js",
      "*.config.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // TypeScript already resolves identifiers; the ESLint core rule cannot see
      // type-space or TS lib globals and reports thousands of false positives.
      "no-undef": "off",

      // Prettier owns formatting — no stylistic rules here.
      "@typescript-eslint/no-explicit-any": REFACTOR,
      "@typescript-eslint/no-unused-vars": [
        REFACTOR,
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        REFACTOR,
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "react-hooks/exhaustive-deps": REFACTOR,

      // Real defects — these stay errors.
      "no-empty": ["error", { allowEmptyCatch: true }],

      "no-restricted-imports": restrict([MODELS_BAN]),
    },
  },

  // Layer boundaries.
  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        MODELS_BAN,
        [
          ["@/app/*", "@/pages/*", "@/features/*", "@/services/*"],
          "shared/ must not depend on any layer above it.",
        ],
      ]),
    },
  },
  {
    files: ["src/services/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        MODELS_BAN,
        [["@/app/*", "@/pages/*", "@/features/*"], "services/ may only import from shared/."],
      ]),
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        MODELS_BAN,
        [["@/app/*", "@/pages/*"], "features/ must not import from app/ or pages/."],
        FEATURE_INTERNALS,
      ]),
    },
  },
  {
    files: ["src/pages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        MODELS_BAN,
        [["@/app/*"], "pages/ must not import from app/."],
        FEATURE_INTERNALS,
      ]),
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([MODELS_BAN, FEATURE_INTERNALS]),
    },
  },

  // Only services/ may reach the network.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/services/**", "src/tests/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        REFACTOR,
        {
          name: "fetch",
          message: "Network access belongs in src/services/. Stores hold state, not HTTP.",
        },
      ],
    },
  },

  // Tests get node globals and a looser leash.
  {
    files: ["src/**/*.test.{ts,tsx}", "src/tests/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-imports": "off",
    },
  },

  // Node scripts and config-adjacent JS.
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
);
