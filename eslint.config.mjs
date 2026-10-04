import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const unusedVariables = {
  argsIgnorePattern: "^_",
  caughtErrors: "none",
  caughtErrorsIgnorePattern: "^_",
  varsIgnorePattern: "^_",
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.tsbuildinfo",
      ".claude/worktrees/**",
      ".scratch/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  {
    files: ["backend/**/*.ts", "shared/**/*.ts", "scripts/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      parserOptions: { tsconfigRootDir: import.meta.dirname },
      globals: {
        ...globals.node,
        ...globals.browser,
        Bun: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", unusedVariables],
    },
  },
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      parserOptions: { tsconfigRootDir: import.meta.dirname },
      globals: {
        ...globals.node,
        Bun: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", unusedVariables],
    },
  },
  {
    files: ["backend/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-asserted-optional-chain": "off",
    },
  },
  {
    files: ["frontend/**/*.{js,jsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "none",
          varsIgnorePattern: "^React$|^_",
        },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
    },
  },
);
