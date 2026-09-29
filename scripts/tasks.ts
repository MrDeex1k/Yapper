import { execFileSync, spawn } from "node:child_process";

// Native artifacts must never share a cache entry across toolchains or targets.
const version = (command: string) =>
  execFileSync(command, ["version"], { encoding: "utf8" }).trim();
const bun = execFileSync("bun", ["--version"], { encoding: "utf8" }).trim();
const key = [process.platform, process.arch, process.version, bun, version("go")].join("-");
const child = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "turbo", "run", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1", YAPPER_TOOLCHAIN_KEY: key },
  },
);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
