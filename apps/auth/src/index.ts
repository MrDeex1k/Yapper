import { Pool } from "pg";
import { createAuth } from "./auth";
import { createApp } from "./app";
import { readConfig } from "./config";
import { internalHandler } from "./internal";

const config = readConfig(process.env);
const database = new Pool({ connectionString: config.databaseURL, max: 10 });
const auth = createAuth(config, database);
const internalSecret = process.env.AUTH_INTERNAL_SECRET ?? "";
if (internalSecret.length < 32) throw new Error("AUTH_INTERNAL_SECRET is required");
const app = createApp(auth, internalHandler(auth, database, internalSecret)).listen({
  port: config.port,
  hostname: process.env.AUTH_HOST ?? "127.0.0.1",
  maxRequestBodySize: 16384,
});
console.info(`AUTH listening on port ${config.port}`);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await app.stop();
  await database.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
