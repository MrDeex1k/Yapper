import { spawn } from "node:child_process";
const child = spawn("go", ["run", "./cmd/yapper", "migrate"], {
  cwd: new URL("../server", import.meta.url),
  stdio: "inherit",
  env: process.env,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
