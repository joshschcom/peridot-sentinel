// Fails if a component hardcodes a colour or uses a banned visual effect.
// Colours live in src/app/globals.css only; components use semantic token classes.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../src");
const ALLOWED = new Set(["app/globals.css", "app/layout.tsx" /* <meta name="theme-color"> needs literal colours */]);
const RULES = [
  [/#[0-9a-fA-F]{3,8}\b(?![0-9a-zA-Z_-])/, "hex colour"],
  [/\b(?:rgba?|hsla?|oklch|oklab)\(/, "colour function"],
  [/gradient/i, "gradient"],
  [/\b(?:bg|text|border|ring|fill|stroke|from|to|via)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d+)?\b/, "default palette class"],
  [/\bshadow-(?:sm|md|lg|xl|2xl|\[)/, "shadow / glow"],
  [/\b(?:blur|backdrop-blur)-/, "blur"],
];
const problems = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "generated") walk(path);
      continue;
    }
    const rel = relative(root, path);
    if (!/\.(tsx?|css)$/.test(name) || /\.test\.ts$/.test(name) || ALLOWED.has(rel)) continue;
    readFileSync(path, "utf8").split("\n").forEach((line, index) => {
      // Hex literals that are data (addresses, hashes, selectors) are not colours: only flag inside class/style contexts.
      for (const [pattern, label] of RULES) {
        if (!pattern.test(line)) continue;
        if (label === "hex colour" && !/(className|style|color|fill=|stroke=|background)/i.test(line)) continue;
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        problems.push(`${rel}:${index + 1}: ${label}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
})(root);
if (problems.length) {
  console.error(`${problems.length} token violation(s):\n${problems.join("\n")}`);
  process.exit(1);
}
console.log("check-tokens: no hardcoded colours, gradients, shadows or default-palette classes in src/");
