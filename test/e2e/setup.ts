import { createHash } from "node:crypto";
import { request, type FullConfig } from "@playwright/test";

export function ownerCredentials() {
  const token = process.env.SETUP_TOKEN;
  if (!token) throw new Error("Run pnpm setup:dev for the disposable Web E2E installation.");
  const password = createHash("sha256").update("yapper-e2e-owner:").update(token).digest("hex");
  return { token, username: "browserowner", password, name: "Yapper browser tests" };
}

export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("The E2E installation address is missing.");
  const response = await fetch(new URL("/api/v1/setup", baseURL), {
    method: "POST",
    headers: { Origin: baseURL, "Content-Type": "application/json" },
    body: JSON.stringify(ownerCredentials()),
    signal: AbortSignal.timeout(10_000),
  });
  // A rerun can use the same disposable database and derived owner credentials.
  if (response.status !== 201 && response.status !== 409) {
    throw new Error(
      `Could not initialize the loopback E2E installation (HTTP ${response.status}).`,
    );
  }

  // Reuse one staff login for fixture access across the browser matrix.
  const api = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    const { username, password } = ownerCredentials();
    const signIn = await api.post("/api/auth/sign-in/username", { data: { username, password } });
    if (!signIn.ok())
      throw new Error(`Could not sign in to the E2E fixture (HTTP ${signIn.status()}).`);
    process.env.YAPPER_E2E_OWNER_STATE = JSON.stringify(await api.storageState());
  } finally {
    await api.dispose();
  }
}
