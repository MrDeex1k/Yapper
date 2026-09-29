import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Uses the real deployment overlay, but replaces public addresses/certificates
// with disposable fixtures. No production volume, credentials or port is used.
const root = resolve(import.meta.dirname, "..");
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 120_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    // Compose output can contain interpolated secrets. Only explicitly selected
    // test output is inherited; do not print captured command output on failure.
    throw new Error(`${command} failed (${result.status ?? result.error?.code})`);
  }
  return result.stdout?.trim();
};
await mkdir(join(root, ".tmp"), { recursive: true });
const dir = await mkdtemp(join(root, ".tmp/turn-test-"));
const project = `yapper-turn-${randomBytes(4).toString("hex")}`;
const fixture = join(dir, "compose.json");
const compose = ["compose", "--project-name", project, "-f", fixture];
let created = false;
try {
  const certs = join(dir, "certs");
  await mkdir(certs, { mode: 0o700 });
  await writeFile(
    join(dir, "openssl.cnf"),
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=turn.yapper.test\n[ext]\nsubjectAltName=DNS:turn.yapper.test,DNS:web.yapper.test\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\n",
  );
  run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-nodes",
    "-days",
    "1",
    "-config",
    join(dir, "openssl.cnf"),
    "-keyout",
    join(certs, "privkey.pem"),
    "-out",
    join(certs, "fullchain.pem"),
  ]);
  const secret = () => randomBytes(32).toString("hex");
  const env = {
    ...process.env,
    YAPPER_DOMAIN: "web.yapper.test",
    YAPPER_PUBLIC_IP: "172.30.245.3",
    YAPPER_TURN_DOMAIN: "turn.yapper.test",
    YAPPER_TURN_CERT_DIR: certs,
    YAPPER_TURN_PROXY_SUBNET: "172.30.245.0/29",
    YAPPER_TURN_PROXY_IP: "172.30.245.2",
    LIVEKIT_API_KEY: "turn-test-key",
    LIVEKIT_API_SECRET: secret(),
    POSTGRES_PASSWORD: secret(),
    AUTH_DB_PASSWORD: secret(),
    APP_DB_PASSWORD: secret(),
    AUTH_SECRET: secret(),
    AUTH_INTERNAL_SECRET: secret(),
    SETUP_TOKEN: secret(),
    SETUP_TOKEN_EXPIRES_AT: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const config = JSON.parse(
    run(
      "docker",
      [
        "compose",
        "--env-file",
        "/dev/null",
        "-f",
        "compose.yaml",
        "-f",
        "compose.turn.yaml",
        "config",
        "--format",
        "json",
      ],
      { env },
    ),
  );
  assert(!config.services.livekit.ports.some((port) => port.target === 7880));
  assert(
    !config.services.ingress.ports.some((port) => port.target === 443 && port.protocol === "tcp"),
  );
  assert(
    config.services["tls-router"].ports.some(
      (port) => port.published === "443" && port.protocol === "tcp",
    ),
  );
  assert(config.services.livekit.ports.some((port) => port.target === 7881));
  assert(config.services.livekit.ports.some((port) => port.target === 7882));

  const arch = run("docker", ["info", "--format", "{{.Architecture}}"]);
  const goarch = { aarch64: "arm64", arm64: "arm64", x86_64: "amd64", amd64: "amd64" }[arch];
  assert(goarch, `Unsupported Docker architecture: ${arch}`);
  run("go", ["test", "-c", "-o", join(dir, "turn.test"), "./internal/deployment"], {
    cwd: join(root, "server"),
    env: { ...process.env, GOOS: "linux", GOARCH: goarch, CGO_ENABLED: "0" },
    stdio: "inherit",
  });
  await writeFile(
    join(dir, "Caddyfile"),
    `{
    auto_https off
  }
  https://web.yapper.test {
    tls /test-certs/fullchain.pem /test-certs/privkey.pem
    respond "https-route-ok"
  }
  `,
  );
  for (const name of ["livekit", "ingress", "tls-router"]) {
    const service = config.services[name];
    delete service.ports;
    delete service.depends_on;
    delete service.build;
    service.restart = "no";
  }
  const livekit = config.services.livekit;
  livekit.networks["turn-proxy"].ipv4_address = "172.30.245.3";
  // Only the isolated test subnet can be a private relay peer. Production
  // retains LiveKit's default denial of private/loopback/link-local peers.
  livekit.environment.LIVEKIT_CONFIG = livekit.environment.LIVEKIT_CONFIG.replace(
    "  enabled: true\n",
    "  enabled: true\n  allow_restricted_peer_cidrs: [172.30.245.0/29]\n",
  );
  config.services.ingress.volumes = [
    {
      type: "bind",
      source: join(dir, "Caddyfile"),
      target: "/etc/caddy/Caddyfile",
      read_only: true,
    },
    { type: "bind", source: certs, target: "/test-certs", read_only: true },
  ];
  config.services = Object.fromEntries(
    ["livekit", "ingress", "tls-router"].map((name) => [name, config.services[name]]),
  );
  config.services.probe = {
    image: livekit.image,
    entrypoint: ["/test/turn.test", "-test.v", "-test.timeout=40s"],
    environment: {
      YAPPER_TURN_TEST: "1",
      LIVEKIT_API_KEY: env.LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: env.LIVEKIT_API_SECRET,
    },
    volumes: [{ type: "bind", source: dir, target: "/test", read_only: true }],
    networks: { "turn-proxy": { ipv4_address: "172.30.245.4" } },
  };
  delete config.name;
  delete config.volumes;
  for (const network of Object.values(config.networks)) delete network.name;
  await writeFile(fixture, JSON.stringify(config), { mode: 0o600 });
  // Pull only upstream images; the ingress image must have been built locally.
  run("docker", [...compose, "pull", "livekit", "tls-router"], { stdio: "inherit" });
  created = true;
  run(
    "docker",
    [...compose, "up", "-d", "--wait", "--wait-timeout", "30", "livekit", "ingress", "tls-router"],
    { stdio: "inherit" },
  );
  run(
    "docker",
    [
      ...compose,
      "exec",
      "-T",
      "tls-router",
      "haproxy",
      "-c",
      "-f",
      "/usr/local/etc/haproxy/haproxy.cfg",
    ],
    { stdio: "inherit" },
  );
  run("docker", [...compose, "run", "--rm", "--no-deps", "probe"], {
    stdio: "inherit",
    timeout: 60_000,
  });
  console.info(
    "PASS: HTTPS/TURN TLS routing, signaling credentials, authenticated relay, PROXY address and restricted peer rejection.",
  );
} finally {
  if (created)
    run("docker", [...compose, "down", "--volumes", "--remove-orphans"], { stdio: "inherit" });
  await rm(dir, { recursive: true, force: true });
}
