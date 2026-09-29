import { Pool } from "pg";
import { createAuth } from "./auth";
import { createApp } from "./app";
import { readConfig } from "./config";

const config = readConfig(process.env);
const database = new Pool({ connectionString: config.databaseURL, max: 10 });
const app = createApp(createAuth(config, database)).listen({
  port: config.port,
  hostname: "0.0.0.0",
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
