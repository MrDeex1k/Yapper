// Runs only as an explicit local test entry point, never imported by the application.
const { app }: typeof import("electron") = require("electron");
const { readFile, writeFile }: typeof import("node:fs/promises") = require("node:fs/promises");
const { join }: typeof import("node:path") = require("node:path");
const { pathToFileURL }: typeof import("node:url") = require("node:url");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");
const directory = process.argv[2];
const phase = process.argv[3];
if (!directory || !phase || !["join", "restore"].includes(phase)) {
  app.exit(2);
  throw new Error("Invalid native smoke arguments");
}
app.setPath("userData", join(directory, "profile"));
const watchdog = setTimeout(() => {
  console.error("Native desktop smoke timed out");
  app.exit(1);
}, 25000);
const loaded = new Promise<import("electron").BrowserWindow>((resolve, reject) => {
  app.once("browser-window-created", (_event, window) => {
    window.hide();
    window.webContents.once("did-fail-load", () => reject(new Error("Renderer failed to load")));
    window.webContents.once("did-finish-load", () => resolve(window));
  });
});
void (async () => {
  const fixture = JSON.parse(await readFile(join(directory, "fixture.json"), "utf8")) as {
    server: string;
    invitation: string;
  };
  await import(pathToFileURL(join(__dirname, "../dist/main.js")).href);
  const window = await loaded;
  // Electron exposes this runtime diagnostic without a public TS declaration.
  // Keep the narrow adapter in the test harness, outside the shipped package.
  const contents = window.webContents as import("electron").WebContents & {
    getLastWebPreferences(): import("electron").WebPreferences;
  };
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.ok(window.webContents.getURL().startsWith("http://127.0.0.1:"));
  const result: { id: string; role: string; server: string | null } = await window.webContents
    .executeJavaScript(`(async () => {
    if (typeof require !== 'undefined' || typeof process !== 'undefined') throw new Error('Renderer has Node access');
    const fixture = ${JSON.stringify(fixture)};
    const phase = ${JSON.stringify(phase)};
    const saved = await window.yapperDesktop.getServer();
    if (phase === 'join') {
      if (saved !== null) throw new Error('Profile is not fresh');
      await window.yapperDesktop.setServer(fixture.server);
      const joined = await fetch('/api/v1/guests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Desktop smoke', invitation: fixture.invitation }) });
      if (joined.status !== 201) throw new Error('Guest admission failed: ' + joined.status);
      if (joined.headers.get('set-cookie')) throw new Error('Guest cookie leaked to renderer');
    } else if (saved !== fixture.server) throw new Error('Selected server not restored');
    const response = await fetch('/api/v1/me');
    if (!response.ok) throw new Error('Persisted guest unavailable: ' + response.status);
    const me = await response.json();
    if (document.cookie.includes('yapper_guest')) throw new Error('Guest cookie available in renderer');
    return { id: me.participant.id, role: me.participant.role, server: await window.yapperDesktop.getServer() };
  })()`);
  await new Promise<void>((resolve) => {
    window.webContents.once("did-finish-load", () => resolve());
    window.webContents.reload();
  });
  const deadline = Date.now() + 5000;
  for (;;) {
    const rendered = await window.webContents.executeJavaScript(
      `document.querySelector('.self-row strong')?.textContent === 'Desktop smoke' && !!document.querySelector('.message-history')`,
    );
    if (rendered) break;
    if (Date.now() >= deadline)
      throw new Error("Conversation did not render after session restoration");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(result.role, "participant");
  assert.equal(result.server, fixture.server);
  const encrypted = await readFile(join(directory, "profile", "servers.encrypted"));
  assert.ok(encrypted.length > 0);
  assert.equal(encrypted.includes(Buffer.from(fixture.server)), false);
  if (phase === "join")
    await writeFile(join(directory, "identity.json"), JSON.stringify({ id: result.id }), {
      mode: 0o600,
    });
  else
    assert.equal(
      result.id,
      JSON.parse(await readFile(join(directory, "identity.json"), "utf8")).id,
    );
  console.info(
    `PASS: native Electron ${phase}, isolated renderer, guest cookie boundary and encrypted persistence`,
  );
  clearTimeout(watchdog);
  app.quit();
})().catch((error) => {
  console.error(error.message);
  app.exit(1);
});
