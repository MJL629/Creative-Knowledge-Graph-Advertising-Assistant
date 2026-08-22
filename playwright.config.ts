import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      CREATIVE_MODEL_PROVIDER: "mock",
      PERSISTENCE_PROVIDER: "memory",
      WORKFLOW_CHECKPOINTER: "memory",
    },
  },
});
