import { spawn } from "node:child_process";
if (!process.env.DATABASE_URL) throw new Error("Development DATABASE_URL is required");
const child = spawn("go", ["test", "-race", "-count=1", "./..."], {
  cwd: new URL("../server", import.meta.url),
  stdio: "inherit",
  env: {
    ...process.env,
    TEST_DATABASE_URL: process.env.DATABASE_URL,
    TEST_LIVEKIT_URL: process.env.LIVEKIT_INTERNAL_URL,
  },
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
