import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const generated = spawnSync(
  "pnpm",
  ["--filter", "@yapper/api", "exec", "openapi-typescript", "openapi.json"],
  { encoding: "utf8" },
);
if (generated.status !== 0) {
  process.stderr.write(generated.stderr);
  process.exit(1);
}
const formatted = spawnSync(
  "pnpm",
  ["exec", "oxfmt", "--stdin-filepath", "packages/api/src/generated.ts"],
  { input: generated.stdout, encoding: "utf8" },
);
if (formatted.status !== 0) {
  process.stderr.write(formatted.stderr);
  process.exit(1);
}
const path = new URL("../packages/api/src/generated.ts", import.meta.url);
if (process.argv.includes("--write")) writeFileSync(path, formatted.stdout);
else if (readFileSync(path, "utf8") !== formatted.stdout) {
  console.error("Generated API types are stale. Run pnpm generate:api.");
  process.exit(1);
}
