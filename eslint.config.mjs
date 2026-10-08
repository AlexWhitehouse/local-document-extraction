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
  {
    // Native dialogs can't be labelled or styled; use confirmDialog from features/ui/confirm.jsx.
    files: ["frontend/src/**/*.{js,jsx}"],
    ignores: ["frontend/src/**/*.test.{js,jsx}", "frontend/src/test/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use confirmDialog from features/ui/confirm.jsx." },
        { name: "alert", message: "Use a toast or an inline message." },
        { name: "prompt", message: "Use a form in a ModalDialog." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "confirm", message: "Use confirmDialog from features/ui/confirm.jsx." },
        { object: "window", property: "alert", message: "Use a toast or an inline message." },
        { object: "window", property: "prompt", message: "Use a form in a ModalDialog." },
      ],
      "no-restricted-imports": [
        "error",
        { name: "sonner", message: "Report outcomes through lib/notify.js so every toast uses the shared messages." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXExpressionContainer > MemberExpression[property.name='message'][object.name=/^(error|err|e|failure|reason)$/]",
          message: "Don't render raw error messages; use describeError from lib/describeError.js.",
        },
        {
          selector: "JSXExpressionContainer > ChainExpression > MemberExpression[property.name='message'][object.name=/^(error|err|e|failure|reason)$/]",
          message: "Don't render raw error messages; use describeError from lib/describeError.js.",
        },
      ],
    },
  },
  {
    // The toast library is wired up in exactly two places: the notifier and the root Toaster.
    files: ["frontend/src/lib/notify.js", "frontend/src/App.jsx"],
    rules: { "no-restricted-imports": "off" },
  },
);
