// Lint rules backing the "Code rules" section in AGENTS.md.
// Rationale and cast-free recipes: docs/coding-rules.md.
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import tseslint from "typescript-eslint";

/** `kv.get<T>()` / `res.json<T>()` claim a type without checking it. */
const pretendValidatingGeneric = {
  selector: "CallExpression[typeArguments][callee.property.name=/^(get|json)$/]",
  message: "This type argument is an unchecked cast. Parse the value with a zod schema instead.",
};

/** Named types belong in src/types, never next to the implementation. */
const typeOutsideTypesFolder = {
  selector: "TSTypeAliasDeclaration, TSInterfaceDeclaration",
  message: "Declare types in src/types/ (see AGENTS.md › Code rules › Types).",
};

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".wrangler/**",
      ".opencode/**",
      "migrations/**",
      "worker-configuration.d.ts",
      "src/types/database.ts", // generated from the Supabase schema
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@eslint-community/eslint-comments": eslintComments },
    rules: {
      // No casts. `as const` stays allowed; the only escape hatch is an
      // eslint-disable comment whose description starts with "cast-reason:".
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-expect-error": true, "ts-ignore": true, "ts-nocheck": true },
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "no-restricted-syntax": ["error", pretendValidatingGeneric],

      // Types: `import type`, `type` over `interface`, `T` prefix.
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "typeAlias", format: ["PascalCase"], prefix: ["T"] },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: false },
      ],

      // Size: a long file or function is a sign it needs splitting.
      "max-lines": ["error", 300],
      "max-lines-per-function": ["error", 50],

      // Named exports only.
      "no-restricted-exports": ["error", { restrictDefaultExports: { direct: true } }],

      // Relaxed for readability: `${amount}` and `(e) => console.error(e)` are clear as written.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/types/**"],
    rules: {
      // Repeats the base selector: a later `no-restricted-syntax` replaces it.
      "no-restricted-syntax": ["error", pretendValidatingGeneric, typeOutsideTypesFolder],
    },
  },
  {
    files: ["src/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/libs/response",
              message: "Services return data; build HTTP responses in src/handlers/.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/utils/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/services/*", "@/routes/*", "@/handlers/*", "@/middlewares/*", "@/libs/*"],
              message: "utils are pure helpers: import only constants, schemas and types.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/index.ts", "*.config.js"],
    rules: {
      // Workers needs a default export for the entrypoint; so do tool configs.
      "no-restricted-exports": "off",
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
