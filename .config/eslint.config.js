import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const REFACTOR = "error";

const restrict = (groups) => [
  REFACTOR,
  { patterns: groups.map(([group, message]) => ({ group, message })) },
];

const FEATURE_INTERNALS = [
  ["@/features/*/*/*"],
  "Import a feature through its public entrypoint, not its internals.",
];

const forbidRawButtonRule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Forbid raw <button> elements in favor of @misty/ui Button, IconButton, or CVA primitives",
    },
    schema: [],
    messages: {
      noRawButton:
        "Do not use raw <button>. Use <Button>, <IconButton>, or a CVA primitive from '@misty/ui'.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name && node.name.type === "JSXIdentifier" && node.name.name === "button") {
          context.report({
            node,
            messageId: "noRawButton",
          });
        }
      },
    };
  },
};

const noNestedComponentRule = {
  meta: {
    type: "problem",
    docs: { description: "Forbid component definitions nested inside another function" },
    schema: [],
    messages: {
      nested:
        "'{{name}}' is a component declared inside another function, so it remounts on every render. Move it to module level and pass what it needs as props.",
    },
  },
  create(context) {
    const isComponentName = (name) => /^[A-Z]/.test(name);
    const insideFunction = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (
          parent.type === "FunctionDeclaration" ||
          parent.type === "FunctionExpression" ||
          parent.type === "ArrowFunctionExpression"
        )
          return true;
      }
      return false;
    };
    return {
      FunctionDeclaration(node) {
        if (node.id && isComponentName(node.id.name) && insideFunction(node))
          context.report({ node: node.id, messageId: "nested", data: { name: node.id.name } });
      },
      VariableDeclarator(node) {
        const init = node.init;
        if (
          node.id.type === "Identifier" &&
          isComponentName(node.id.name) &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") &&
          insideFunction(node)
        )
          context.report({ node: node.id, messageId: "nested", data: { name: node.id.name } });
      },
    };
  },
};

const sharedUiPlugin = {
  rules: {
    "no-raw-button": forbidRawButtonRule,
    "no-nested-component": noNestedComponentRule,
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "vendor/**",
      "src-tauri/**",
      ".config/**",
      "docs/**",
      "tasks/**",
      "*.config.js",
      "*.config.ts",
      "**/*.min.js",
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
    plugins: {
      "react-hooks": reactHooks,
      "shared-ui": sharedUiPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      "no-undef": "off",

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

      "no-empty": ["error", { allowEmptyCatch: true }],

      "shared-ui/no-raw-button": "warn",
      "shared-ui/no-nested-component": "error",
    },
  },

  {
    files: ["**/*.test.{ts,tsx}", "src/tests/**/*.{ts,tsx}"],
    rules: {
      "shared-ui/no-raw-button": "off",
    },
  },

  {
    files: ["src/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        [
          ["@/api/*", "@/app/*", "@/features/*", "@/native/*"],
          "shared/ must not depend on any layer above it.",
        ],
      ]),
    },
  },
  {
    files: ["src/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        [["@/app/*", "@/features/*"], "api/ must not depend on application or features."],
      ]),
    },
  },
  {
    files: ["src/native/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        [["@/api/*", "@/app/*", "@/features/*"], "native/ must not depend on application layers."],
      ]),
    },
  },
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([
        [
          ["@/app/*", "!@/app/shell", "!@/app/shell/*"],
          "features/ must not import from app/ (except the shell state in app/shell).",
        ],
        FEATURE_INTERNALS,
      ]),
    },
  },
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrict([FEATURE_INTERNALS]),
    },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/api/**",
      "src/features/*/api/**",
      "src/features/*/*/api/**",
      "src/features/*/*/*/api/**",
      "src/tests/**",
      "src/**/*.test.{ts,tsx}",
    ],
    rules: {
      "no-restricted-globals": [
        REFACTOR,
        {
          name: "fetch",
          message: "Network access belongs in src/api/ or a feature's api/ folder. Stores hold state, not HTTP.",
        },
      ],
    },
  },

  {
    files: [
      "src/**/*.test.{ts,tsx}",
      "src/**/*.testFixtures.{ts,tsx}",
      "src/**/*.test_fixtures.ts",
      "src/tests/**/*.{ts,tsx}",
    ],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-imports": "off",
      "shared-ui/no-nested-component": "off",
    },
  },

  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node } },
  },
);
