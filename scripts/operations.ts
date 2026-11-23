import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { setImmediate } from "node:timers/promises";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string", default: "yapper" },
    "env-file": { type: "string", default: ".env" },
    smoke: { type: "boolean" },
    turn: { type: "boolean" },
    "leave-stopped": { type: "boolean" },
  },
});
const [command, archive] = positionals;
const project = values.project;
const profile = values.turn ? "turn" : values.smoke ? "smoke" : "base";
const overlay = profile === "base" ? undefined : "compose." + profile + ".yaml";
const files = ["compose.yaml", ...(overlay ? [overlay] : [])];
const databases = [
  { name: "yapper_auth", password: "AUTH_DB_PASSWORD" },
  { name: "yapper_app", password: "APP_DB_PASSWORD" },
];
const turnFiles = values.turn ? ["fullchain.pem", "privkey.pem"] : [];
const archiveFiles = [
  ".env",
  "images.json",
  ...files,
  ...turnFiles,
  ...databases.map(({ name }) => name + ".dump"),
];
const maintenance = [
  "ingress",
  "server",
  "auth",
  "livekit",
  ...(values.turn ? ["tls-router", "turn-proxy"] : []),
];
let envFile = resolve(values["env-file"]);
function deploymentEnvironment() {
  const env = { ...process.env };
  // Compose gives the shell precedence over --env-file. Keep Docker client
  // settings, but resolve deployment values entirely from the selected file.
  const sources = [...files.map((file) => join(root, file)), envFile];
  for (const path of sources) {
    const source = readFileSync(path, "utf8");
    for (const [, braced, bare] of source.matchAll(/\$(?:\{([A-Za-z_]\w*)|([A-Za-z_]\w*))/g)) {
      const name = braced ?? bare;
      if (name) delete env[name];
    }
  }
  return env;
}
const compose = (...args: string[]) => [
  "compose",
  "--project-name",
  project,
  "--env-file",
  envFile,
  ...files.flatMap((file) => ["-f", file]),
  ...args,
];
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    cwd: root,
    env: args[0] === "compose" ? deploymentEnvironment() : process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
const services = () =>
  docker(...compose("ps", "--services", "--status", "running"))
    .trim()
    .split(/\s+/);

async function checksum(path: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path, { flags: "r", signal })) hash.update(bytes);
  return hash.digest("hex");
}

type Manifest = {
  format: number;
  project: string;
  profile: string;
  revision: string;
  dirtySource: boolean;
  createdAt: string;
  files: Record<string, string>;
};

type ComposeService = {
  image?: string;
  environment?: Record<string, string | null>;
  volumes?: { source: string; target: string }[];
};

const migrationServices = ["auth-migrate", "server-migrate"];
function checkMigrations() {
  for (const service of migrationServices) {
    const ids = docker(
      "ps",
      "--quiet",
      "--filter",
      "label=com.docker.compose.project=" + project,
      "--filter",
      "label=com.docker.compose.service=" + service,
    );
    if (ids.trim()) throw new Error("Wait for the running " + service + " before maintenance");
  }
}

function sourceConfiguration() {
  const model = JSON.parse(docker(...compose("config", "--format", "json"))) as {
    services: Record<string, ComposeService>;
  };
  const containers = docker(
    "ps",
    "--all",
    "--quiet",
    "--filter",
    "label=com.docker.compose.project=" + project,
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (containers.length === 0) throw new Error("The backup project has no containers");
  const installed = JSON.parse(docker("inspect", ...containers)) as {
    Config: { Env: string[]; Image: string; Labels: Record<string, string> };
    Mounts: { Source: string; Destination: string }[];
  }[];
  for (const { Config: config, Mounts } of installed) {
    if (config.Labels["com.docker.compose.oneoff"] === "True") continue;
    const service = config.Labels["com.docker.compose.service"];
    if (!service)
      throw new Error("The backup project contains a container without a service label");
    const expected = model.services[service];
    if (!expected)
      throw new Error("The selected profile omits the installed " + service + " service");
    if (expected.image && config.Image !== expected.image) {
      throw new Error("The installed " + service + " image differs from the archive configuration");
    }
    if (service === "livekit" && values.turn) {
      const expectedPath = expected.volumes?.find(({ target }) => target === "/turn-certs")?.source;
      const mount = Mounts.find(({ Destination }) => Destination === "/turn-certs");
      if (!expectedPath || mount?.Source !== expectedPath) {
        throw new Error(
          "The installed TURN certificate mount differs from the archive configuration",
        );
      }
    }
    const actual = new Map(
      config.Env.map((entry) => {
        const index = entry.indexOf("=");
        return [entry.slice(0, index), entry.slice(index + 1)];
      }),
    );
    for (const [key, value] of Object.entries(expected.environment ?? {})) {
      if (value !== null && actual.get(key) !== value) {
        throw new Error(
          "The installed " +
            service +
            " service differs from the archive environment (" +
            key +
            ")",
        );
      }
    }
  }
  return model;
}

async function verify(directory: string) {
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")) as Manifest;
  if (
    manifest.format !== 1 ||
    manifest.profile !== profile ||
    !/^[0-9a-f]{40}$/.test(manifest.revision) ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  ) {
    throw new Error("Archive format, revision, or Compose profile is invalid");
  }
  for (const name of archiveFiles) {
    if ((await checksum(join(directory, name))) !== manifest.files[name]) {
      throw new Error("Archive checksum mismatch for " + name);
    }
  }
  return manifest;
}

function databaseCommand(database: (typeof databases)[number], program: string, args: string[]) {
  return compose(
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    'export PGPASSWORD="$' + database.password + '"; exec "$@"',
    "database",
    program,
    "-h",
    "127.0.0.1",
    "-U",
    database.name,
    ...args,
  );
}

function transferDatabase(
  directory: string,
  database: (typeof databases)[number],
  mode: "dump" | "list" | "restore",
) {
  const path = join(directory, database.name + ".dump");
  const output = mode === "dump";
  const fd = output ? openSync(path, "wx", 0o600) : openSync(path, "r");
  const [program, ...args] =
    mode === "dump"
      ? ["pg_dump", "--format=custom", "--no-owner", "--no-privileges", database.name]
      : mode === "list"
        ? ["pg_restore", "--list"]
        : [
            "pg_restore",
            "--exit-on-error",
            "--single-transaction",
            "--no-owner",
            "--no-privileges",
            "-d",
            database.name,
          ];
  try {
    const result = spawnSync("docker", databaseCommand(database, program, args), {
      cwd: root,
      env: deploymentEnvironment(),
      stdio: output ? ["ignore", fd, "pipe"] : [fd, "ignore", "pipe"],
    });
    if (result.status !== 0) throw new Error(mode + " failed for " + database.name);
  } finally {
    closeSync(fd);
  }
}

async function backup(directory: string) {
  checkMigrations();
  const running = services();
  const paused = maintenance.filter((service) => running.includes(service));
  if (!running.includes("postgres")) throw new Error("PostgreSQL is not running");
  const environment = readFileSync(envFile);
  const config = sourceConfiguration();
  if (!environment.equals(readFileSync(envFile)))
    throw new Error("The environment file changed during backup validation");
  mkdirSync(directory, { mode: 0o700 });
  const interruption = new AbortController();
  const interrupt = (signal: NodeJS.Signals) => {
    interruption.abort(new Error("Backup interrupted by " + signal));
    process.exitCode = signal === "SIGINT" ? 130 : 143;
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  let needsResume = paused.length > 0;
  let complete = false;
  try {
    if (needsResume) docker(...compose("stop", ...paused));
    await setImmediate(undefined, { signal: interruption.signal });
    checkMigrations();
    const manifest: Manifest = {
      format: 1,
      project,
      profile,
      createdAt: new Date().toISOString(),
      dirtySource: Boolean(
        execFileSync("git", ["status", "--porcelain"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
      ),
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      files: {},
    };
    writeFileSync(join(directory, ".env"), environment, { mode: 0o600 });
    writeFileSync(
      join(directory, "images.json"),
      docker(...compose("images", "--format", "json")),
      { mode: 0o600 },
    );
    for (const name of files) {
      writeFileSync(join(directory, name), readFileSync(join(root, name)), {
        mode: 0o600,
      });
    }
    if (turnFiles.length > 0) {
      const mount = config.services.livekit?.volumes?.find(
        ({ target }) => target === "/turn-certs",
      );
      if (!mount) throw new Error("TURN certificate mount is missing");
      for (const name of turnFiles) {
        writeFileSync(join(directory, name), readFileSync(join(mount.source, name)), {
          mode: 0o600,
        });
      }
    }
    for (const db of databases) {
      transferDatabase(directory, db, "dump");
      transferDatabase(directory, db, "list");
      await setImmediate(undefined, { signal: interruption.signal });
    }
    if (needsResume && !values["leave-stopped"]) {
      docker(...compose("start", ...paused));
      needsResume = false;
    }
    for (const name of archiveFiles) {
      manifest.files[name] = await checksum(join(directory, name), interruption.signal);
    }
    writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
      mode: 0o600,
    });
    complete = true;
  } catch (error) {
    throw interruption.signal.reason ?? error;
  } finally {
    try {
      if (needsResume && !complete) docker(...compose("start", ...paused));
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
  }
  console.info("Verified coordinated backup written to " + directory);
}

async function restore(directory: string) {
  const manifest = await verify(directory);
  if (manifest.project === project) throw new Error("Restore into a different Compose project");
  for (const name of files) {
    if ((await checksum(join(root, name))) !== manifest.files[name]) {
      throw new Error("Check out the archived Compose configuration before restoring");
    }
  }
  envFile = join(directory, ".env");
  if (
    docker(...compose("ps", "--all", "--quiet")).trim() ||
    docker(
      "volume",
      "ls",
      "--quiet",
      "--filter",
      "label=com.docker.compose.project=" + project,
    ).trim()
  ) {
    throw new Error("Restore project already has containers or volumes");
  }
  docker(...compose("up", "-d", "--wait", "postgres"));
  for (const database of databases) transferDatabase(directory, database, "list");
  for (const database of databases) transferDatabase(directory, database, "restore");
  console.info(
    "Restored both databases. Start the verified image revision with the archived environment.",
  );
}

function recoverOwner() {
  checkMigrations();
  if (services().some((service) => maintenance.includes(service))) {
    throw new Error("Stop the application, ingress and media services before recovering the owner");
  }
  if (process.stdin.isTTY) throw new Error("Provide the password from a private file on stdin");
  const result = spawnSync(
    "docker",
    compose("run", "--rm", "--no-deps", "-T", "auth", "bun", "src/operator.ts"),
    {
      cwd: root,
      env: deploymentEnvironment(),
      stdio: "inherit",
    },
  );
  if (result.status !== 0) throw new Error("Owner recovery failed");
}

function diagnostics() {
  const statuses = docker(...compose("ps", "--all", "--format", "json")).trim();
  const containers = statuses
    ? statuses.split("\n").flatMap((row) => JSON.parse(row) as unknown)
    : [];
  const inventory = containers.map((row) => {
    const { Service, State, Health, Image } = row as Record<string, unknown>;
    return {
      service: Service,
      state: State,
      health: Health,
      image: typeof Image === "string" ? basename(Image) : "",
    };
  });
  let checks: unknown = null;
  if (services().some((service) => ["auth", "server", "livekit"].includes(service))) {
    try {
      checks = JSON.parse(
        docker(
          ...compose(
            "run",
            "--rm",
            "--no-deps",
            "--pull",
            "never",
            "-T",
            "--entrypoint",
            "bun",
            "auth",
            "-e",
            `
        const read = async (url, fields) => {
          try {
            const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
            if (!response.ok && response.status !== 503) return { ready: false };
            const body = await response.json();
            return Object.fromEntries(Object.entries(fields)
              .filter(([key, type]) => typeof body[key] === type)
              .map(([key]) => [key, body[key]]));
          } catch { return { ready: false }; }
        };
        const [application, auth, media] = await Promise.all([
          read("http://server:8080/internal/diagnostics", {
            ready: "boolean", database: "boolean", eventStreams: "number", activeGrants: "number",
          }),
          read("http://auth:3001/readyz", { ready: "boolean" }),
          fetch("http://livekit:7880/", { signal: AbortSignal.timeout(2500) }).then(
            (response) => ({ ready: response.ok }), () => ({ ready: false }),
          ),
        ]);
        console.log(JSON.stringify({ application, auth, media }));
      `,
          ),
        ),
      );
    } catch {
      checks = { unavailable: true };
    }
  }
  console.log(
    JSON.stringify({ project, collectedAt: new Date().toISOString(), inventory, checks }, null, 2),
  );
}

async function withOperatorLock(run: () => void | Promise<void>) {
  const lock = join(tmpdir(), "yapper-ops-" + (process.getuid?.() ?? "host") + "-" + project);
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error("Another operator command owns " + lock);
  }
  try {
    await run();
  } finally {
    rmdirSync(lock);
  }
}

try {
  if (values.smoke && values.turn) throw new Error("Choose one Compose profile");
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error("Invalid Compose project name");
  const directory = archive ? resolve(archive) : undefined;
  switch (command) {
    case "backup":
      if (!directory) throw new Error("Provide a new backup directory");
      await withOperatorLock(() => backup(directory));
      break;
    case "verify":
      if (!directory) throw new Error("Provide a backup directory");
      await verify(directory);
      console.info("Archive checksums verified.");
      break;
    case "restore":
      if (!directory) throw new Error("Provide a backup directory");
      await withOperatorLock(() => restore(directory));
      break;
    case "recover-owner":
      await withOperatorLock(recoverOwner);
      break;
    case "diagnostics":
      diagnostics();
      break;
    default:
      throw new Error("Expected backup, verify, restore, recover-owner or diagnostics");
  }
} catch (error) {
  // Docker can include interpolated configuration in stderr. Only defined errors are safe to print.
  console.error(
    error instanceof Error && !("stderr" in error) && !("path" in error)
      ? error.message
      : "Operator command failed. Review the local service state.",
  );
  process.exitCode ??= 1;
}
