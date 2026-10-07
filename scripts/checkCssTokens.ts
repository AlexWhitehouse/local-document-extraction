import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Glob } from "bun";

// Design-token lint for frontend CSS. Colours, and z-index numbers, must come from
// custom properties declared in :root. Exempt outside :root:
//   - blocks whose selector is @media (forced-colors: ...)
//   - any line carrying an explicit `/* token-exempt: <reason> */` comment
export interface TokenViolation {
  file: string;
  line: number;
  message: string;
}

const EXEMPT_COMMENT = /\/\*\s*token-exempt:\s*\S[^*]*\*\//;

const PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /#[0-9a-fA-F]{3,8}\b/, message: "hex colour" },
  { pattern: /\b(?:rgba?|hsla?)\(/, message: "rgb/hsl colour function" },
  { pattern: /\bz-index\s*:\s*-?\d+/, message: "numeric z-index" },
];

// Replace comment bodies with spaces so commented-out text is not scanned. Newlines are kept for line numbers.
function blankComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

export function findCssTokenViolations(file: string, text: string): TokenViolation[] {
  const rawLines = text.split("\n");
  const lines = blankComments(text).split("\n");
  const violations: TokenViolation[] = [];
  // Stack of exempt flags, one per open block. Selector text is collected since the last { } or ;.
  const stack: boolean[] = [];
  let selector = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const exemptLine = EXEMPT_COMMENT.test(rawLines[i] ?? "");
    // Mask characters that sit inside exempt blocks, tracking braces as we go.
    let masked = "";

    for (const ch of line) {
      masked += stack.some(Boolean) ? " " : ch;

      if (ch === "{") {
        const s = selector.trim();
        stack.push(/^:root\b/.test(s) || /^@media\b[^{]*forced-colors/.test(s));
        selector = "";
      } else if (ch === "}") {
        stack.pop();
        selector = "";
      } else if (ch === ";") {
        selector = "";
      } else {
        selector += ch;
      }
    }

    selector += "\n";

    if (exemptLine) continue;

    for (const { pattern, message } of PATTERNS) {
      if (pattern.test(masked)) {
        violations.push({ file, line: i + 1, message: `${message}: ${line.trim()}` });
      }
    }
  }

  return violations;
}

export async function checkCssTokens(srcDir: string): Promise<TokenViolation[]> {
  const violations: TokenViolation[] = [];

  for await (const path of new Glob("**/*.css").scan({ cwd: srcDir, absolute: true })) {
    const file = relative(srcDir, path);
    violations.push(...findCssTokenViolations(file, readFileSync(path, "utf8")));
  }

  return violations.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
}

if (import.meta.main) {
  const srcDir = resolve(import.meta.dir, "..", "frontend", "src");
  const violations = await checkCssTokens(srcDir);

  if (violations.length > 0) {
    for (const v of violations) {
      console.error(`frontend/src/${v.file}:${v.line}: ${v.message}`);
    }

    console.error(`\n${violations.length} CSS token violation(s). Use a :root token, or add /* token-exempt: reason */ on the line.`);
    process.exit(1);
  }

  console.log("CSS token check passed.");
}
