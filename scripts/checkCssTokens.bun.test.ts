import { describe, expect, test } from "bun:test";
import { findCssTokenViolations } from "./checkCssTokens";

describe("findCssTokenViolations", () => {
  test("allows colour literals inside :root and forced-colors blocks", () => {
    const css = [
      ":root {",
      "  --pane-main: #070a0f;",
      "  --scrim: rgba(2, 4, 8, 0.8);",
      "}",
      "@media (forced-colors: active) {",
      "  .x { outline: 2px solid CanvasText; color: #fff; }",
      "}",
    ].join("\n");

    expect(findCssTokenViolations("a.css", css)).toEqual([]);
  });

  test("flags hex, rgb, hsl colours and numeric z-index outside :root", () => {
    const css = [
      ":root { --a: #000; }",
      ".btn {",
      "  color: #abc;",
      "  background: rgba(1, 2, 3, 0.4);",
      "  border-color: hsl(10 20% 30%);",
      "  z-index: 40;",
      "}",
    ].join("\n");

    const found = findCssTokenViolations("b.css", css);
    expect(found.map((v) => v.line)).toEqual([3, 4, 5, 6]);
  });

  test("ignores colours in comments and honours token-exempt markers", () => {
    const css = [
      "/* old colour #123456 */",
      ".mask { mask-image: linear-gradient(#000, transparent); } /* token-exempt: mask needs an opaque stop */",
      ".a { color: var(--text-1); z-index: var(--z-popover); }",
    ].join("\n");

    expect(findCssTokenViolations("c.css", css)).toEqual([]);
  });

  test("resumes checking after a :root block closes", () => {
    const css = [":root { --a: #000; }", ".x { color: #111; }"].join("\n");
    expect(findCssTokenViolations("d.css", css).map((v) => v.line)).toEqual([2]);
  });
});
