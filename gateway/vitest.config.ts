import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /**
     * Vitest 4 dropped `dist/` from its default excludes, and the default
     * `include` matches compiled `.js` as readily as `.ts`. So after any
     * `npm run build`, every suite ran twice: once from src, once from the
     * compiled copy in dist.
     *
     * That is worse than merely slow. The dist half is frozen at whatever the
     * last build produced, so the reported test count drifted between runs
     * depending on build state, and a stale compiled suite could fail against
     * source that had legitimately changed — a failure with no matching test
     * to look at. Roughly half of a "670 passing" run was this shadow copy.
     */
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
