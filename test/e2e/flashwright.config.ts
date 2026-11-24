import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./setup.ts",
  outputDir: "../../test-results/flashwright",
  reporter: "list",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:18090",
    locale: "en-US",
    isolation: "strict",
    waitForAnimations: true,
    failFastWhenIdle: false,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    {
      name: "firefox",
      use: {
        browserName: "firefox",
        // The loopback fixture has no multicast DNS across its container network.
        launchOptions: {
          firefoxUserPrefs: {
            "media.peerconnection.ice.loopback": true,
            "media.peerconnection.ice.obfuscate_host_addresses": false,
          },
        },
      },
    },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
