import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Most tests here run real git, one command after another, and each command is a new process. On Windows a
    // process takes ~55ms to start and test files side by side queue for them, so a test that takes 2 seconds alone
    // can take 25 with two copies of the repo testing at once. Every test gets the same long limit, not one each.
    testTimeout: 60_000,
  },
});
