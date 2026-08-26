import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest 4 dropped "dist" from its default excludes, which made stale
    // compiled test copies in dist/ run alongside the real ones in src/.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
