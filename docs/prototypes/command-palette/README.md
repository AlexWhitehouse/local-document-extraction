# Command palette prototype

Design prototype for the ⌘K / Ctrl+K command palette. It's a single self-contained HTML file with mock data and no backend.

- **Chosen design:** variant **A · Spotlight**. Variants B, C and D stay in the same file for reference. Use the switcher at the top to see them.
- **Open it:** open `index.html` in a browser, or serve this folder with `python3 -m http.server`.
- **Try it:** the "Try" buttons type an example request into the palette. Press ⌘K or Ctrl+K to open and close it.

The interpretation step is mocked in the browser. In the real feature, step 2 below is one call to the assistant model.

1. A local parser turns the sentence into typed pills (Action, Quantity, Subject, Field, Condition, Date, Status and so on).
2. Interpretation resolves unknown words, fields that appear on more than one template, and follow-ups into a checked filter or action.
3. The search runs against an index, and actions come from a fixed list, so the model never decides which documents match.

The screenshots in `screenshots/` show each variant.
