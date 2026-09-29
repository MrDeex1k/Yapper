import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
const server = process.env.DESKTOP_TEST_SERVER;
const invitation = process.env.DESKTOP_TEST_INVITATION;
if (!server || !invitation)
  throw new Error("DESKTOP_TEST_SERVER and a fresh DESKTOP_TEST_INVITATION are required");
const requireDesktop = createRequire(new URL("../apps/desktop/package.json", import.meta.url));
const electron: string = requireDesktop("electron");
await mkdir(".tmp", { recursive: true });
const directory = await mkdtemp(join(process.cwd(), ".tmp", "desktop-native-"));
try {
  await mkdir(join(directory, "profile"));
  await writeFile(join(directory, "fixture.json"), JSON.stringify({ server, invitation }), {
    mode: 0o600,
  });
  for (const phase of ["join", "restore"]) {
    await new Promise<void>((resolve, reject) => {
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      delete environment.DESKTOP_TEST_INVITATION;
      const child = spawn(
        electron,
        ["apps/desktop/.test-tools/native-smoke.cjs", directory, phase],
        {
          stdio: "inherit",
          env: environment,
        },
      );
      const timeout = setTimeout(() => child.kill("SIGKILL"), 30000);
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error(`Native desktop ${phase} failed (${code})`));
      });
    });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
