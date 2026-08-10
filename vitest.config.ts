import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      reporter: ["text", "html"],
      include: ["src/main/services/**/*.ts", "src/shared/**/*.ts"]
    }
  }
});
