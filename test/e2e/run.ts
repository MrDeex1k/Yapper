import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(import.meta.resolve("@playwright/test/cli")),
    "test",
    "--config",
    fileURLToPath(new URL("./flashwright.config.ts", import.meta.url)),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: { ...process.env, FLASHWRIGHT_SESSION: "0" } },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
