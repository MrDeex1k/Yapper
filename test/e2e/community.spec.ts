import { randomInt, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page, type Response } from "@playwright/test";
import { en, pl } from "../../packages/i18n/src/index.ts";
import { ownerCredentials } from "./setup.ts";

const invitationsPath = "/api/v1/invitations";
const channelsPath = "/api/v1/channels";
const unique = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`;

function apiResponse(method: string, path: string, status: number) {
  return (response: Response) =>
    response.request().method() === method &&
    new URL(response.url()).pathname === path &&
    response.status() === status;
}

async function signIn(page: Page) {
  const { username, password } = ownerCredentials();
  await page.goto("/");
  await page.getByRole("combobox", { name: en.language }).selectOption("en");
  await page.getByRole("button", { name: en.staffSignIn, exact: true }).click();
  await page.getByLabel(en.username, { exact: true }).fill(username);
  await page.getByLabel(en.password, { exact: true }).fill(password);
  await Promise.all([
    page.waitForResponse(apiResponse("POST", "/api/auth/sign-in/username", 200)),
    page.getByRole("button", { name: en.signIn, exact: true }).click(),
  ]);
  await expect(page.getByText(en.serverTools, { exact: true })).toBeVisible();
}

async function openOwner(page: Page) {
  const stored = process.env.YAPPER_E2E_OWNER_STATE;
  if (!stored) throw new Error("E2E owner session was not initialized.");
  const { cookies } = JSON.parse(stored) as Awaited<ReturnType<APIRequestContext["storageState"]>>;
  await page.context().addCookies(cookies);
  await page.goto("/");
  await expect(page.getByText(en.serverTools, { exact: true })).toBeVisible();
}

async function openTool(page: Page, name: string) {
  await page.getByText(en.serverTools, { exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

async function inviteGuests(owner: Page, maxUses: number): Promise<string> {
  const tokenResponse = await owner.request.get("/api/auth/token");
  expect(tokenResponse.ok()).toBe(true);
  const { token } = (await tokenResponse.json()) as { token: string };
  const invitation = await owner.request.post(invitationsPath, {
    headers: { Authorization: `Bearer ${token}`, Origin: new URL(owner.url()).origin },
    data: { maxUses },
  });
  expect(invitation.status()).toBe(201);
  return ((await invitation.json()) as { token: string }).token;
}

async function join(page: Page, name: string, code: string) {
  await page.goto("/");
  await page.getByRole("combobox", { name: en.language }).selectOption("en");
  await page.getByRole("textbox", { name: en.nickname }).fill(name);
  await page.getByRole("textbox", { name: en.invitation }).fill(code);
  await page.getByRole("button", { name: en.joinAction }).click();
  await expect(page.getByRole("button", { name: "general", exact: true })).toBeVisible();
}

test("loads, refreshes, creates and revokes invitations", async ({ page, browserName }) => {
  // The loopback fixture shares the server's sign-in rate limit across all browsers.
  if (browserName === "chromium") await signIn(page);
  else await openOwner(page);
  const list = apiResponse("GET", invitationsPath, 200);
  await Promise.all([page.waitForResponse(list), openTool(page, en.admissionSettings)]);
  const panel = page.getByRole("region", { name: en.admissionSettings });
  const refresh = panel.getByRole("button", { name: en.refreshInvitations });
  await Promise.all([page.waitForResponse(list), refresh.click()]);
  const uses = randomInt(1000, 1_000_000_000).toString();
  await panel.getByRole("spinbutton", { name: en.invitationUses }).fill(uses);
  await Promise.all([
    page.waitForResponse(list),
    panel.getByRole("button", { name: en.createInvitation }).click(),
  ]);
  const code = panel.getByRole("textbox", { name: en.invitation });
  await expect(code).not.toHaveValue("");
  const created = panel.getByRole("listitem").filter({ hasText: `${en.remainingUses} ${uses}` });
  await expect(created).toHaveCount(1);
  await Promise.all([
    page.waitForResponse(list),
    created.getByRole("button", { name: en.revokeInvitation }).click(),
  ]);
  await expect(created.getByText(en.invitationRevoked)).toBeVisible();
  await expect(code).toBeHidden();
});

test("validates channel changes, protects drafts and retries a failed save", async ({ page }) => {
  await openOwner(page);
  await openTool(page, en.manageChannels);
  const panel = page.getByRole("region", { name: en.manageChannels });
  const form = panel.locator("#channel-editor");
  const chooser = panel.getByRole("combobox", { name: en.channel, exact: true });
  const name = form.getByRole("textbox", { name: en.channelName });
  const submit = form.locator("button[type=submit]");
  let createRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === channelsPath) {
      createRequests++;
    }
  });

  await name.fill("  ");
  await submit.click();
  await expect(form.getByText(en.channelNameError)).toBeVisible();
  await expect(name).toBeFocused();
  expect(createRequests).toBe(0);

  await name.fill("Draft only");
  await chooser.selectOption({ label: "Lounge" });
  const discard = page.getByRole("alertdialog", { name: en.discardChannelChanges });
  await discard.getByRole("button", { name: en.keepEditingChannel }).click();
  await expect(discard).toBeHidden();
  await expect(name).toHaveValue("Draft only");
  await expect(chooser).toBeFocused();
  await chooser.selectOption({ label: "Lounge" });
  await discard.getByRole("button", { name: en.discardChannelEdits }).click();
  await expect(name).toHaveValue("Lounge");

  const category = unique("Browser category");
  const categoryForm = panel.locator("form").filter({ has: page.getByLabel(en.categoryName) });
  await categoryForm.getByLabel(en.categoryName).fill(category);
  await categoryForm.getByRole("button", { name: en.create, exact: true }).click();
  await expect(panel.locator("option").filter({ hasText: category }).first()).toBeAttached();

  await chooser.selectOption("");
  const title = unique("Browser voice");
  await name.fill(`  ${title}  `);
  await form.getByRole("combobox", { name: en.channelKind }).selectOption("voice");
  await page.route(`**${channelsPath}`, (route) => route.fulfill({ status: 503, json: {} }), {
    times: 1,
  });
  await Promise.all([page.waitForResponse(apiResponse("POST", channelsPath, 503)), submit.click()]);
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(name).toHaveValue(`  ${title}  `);
  await Promise.all([page.waitForResponse(apiResponse("POST", channelsPath, 200)), submit.click()]);
  await expect(name).toHaveValue("");
  await chooser.selectOption({ label: title });
  await expect(name).toHaveValue(title);

  const renamed = unique("Renamed voice");
  await name.fill(renamed);
  await form
    .getByRole("combobox", { name: en.category, exact: true })
    .selectOption({ label: category });
  await submit.click();
  await expect(chooser.locator("option:checked")).toHaveText(renamed);
  await chooser.selectOption({ label: "Lounge" });
  await chooser.selectOption({ label: renamed });
  await expect(
    form.getByRole("combobox", { name: en.category }).locator("option:checked"),
  ).toHaveText(category);
  await panel.getByRole("button", { name: en.archiveChannel }).click();
  await expect(panel.getByText(en.confirmArchive)).toBeVisible();
  await panel.getByRole("button", { name: en.archiveChannel }).click();
  await expect(chooser.locator("option:checked")).toHaveText(`${renamed} (${en.archived})`);
});

test("delivers a message between sessions and restores history after reload", async ({
  page,
  browser,
}) => {
  await openOwner(page);
  const code = await inviteGuests(page, 2);
  const first = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: "en-US" });
  try {
    const second = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      locale: "en-US",
    });
    try {
      const sender = await first.newPage();
      const recipient = await second.newPage();
      await join(sender, unique("Sender"), code);
      await join(recipient, unique("Recipient"), code);
      const message = unique("Flashwright chat próba");
      const composer = sender.getByRole("textbox", { name: en.messagePlaceholder });
      await composer.fill(message);
      await composer.press("Enter");
      await expect(sender.getByText(message, { exact: true })).toBeVisible();
      await expect(recipient.getByText(message, { exact: true })).toBeVisible();
      await expect(composer).toHaveValue("");
      await recipient.reload();
      await expect(recipient.getByText(message, { exact: true })).toBeVisible();
      await recipient.getByRole("combobox", { name: en.language }).selectOption("pl");
      await expect(recipient.getByRole("textbox", { name: pl.messagePlaceholder })).toBeVisible();
    } finally {
      await second.close();
    }
  } finally {
    await first.close();
  }
});

test("joins voice muted, switches microphone modes and leaves", async ({ page, browser }) => {
  await openOwner(page);
  const code = await inviteGuests(page, 1);
  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    locale: "en-US",
  });
  try {
    const guest = await context.newPage();
    await join(guest, unique("Voice guest"), code);
    await guest.getByRole("button", { name: "Lounge", exact: true }).click();
    const mute = guest.getByRole("button", { name: en.unmute });
    await expect(mute).toBeEnabled({ timeout: 20_000 });
    const pushToTalk = guest.getByRole("checkbox", { name: new RegExp(en.pushToTalk, "i") });
    await expect(pushToTalk).toBeHidden();
    await guest.getByRole("button", { name: en.voiceDetails }).click();
    // Stage 7 moves the switch inside the Audio settings disclosure.
    const audioSettings = guest.locator("summary").getByText("Audio settings", { exact: true });
    if (await audioSettings.isVisible()) await audioSettings.click();
    await pushToTalk.press("Space");
    await expect(pushToTalk).toBeChecked();
    await expect(mute).toBeHidden();
    await pushToTalk.press("Space");
    await expect(pushToTalk).not.toBeChecked();
    await expect(mute).toBeVisible();
    const leave = guest.getByRole("button", { name: en.leaveVoice });
    await Promise.all([
      guest.waitForResponse(apiResponse("POST", "/api/v1/voice/leave", 200)),
      leave.click(),
    ]);
    await expect(leave).toBeHidden();
  } finally {
    await context.close();
  }
});
