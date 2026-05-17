/**
 * Daemon contract tests — verify the WhatsApp daemon's API surface matches
 * what Kit's gateway depends on.
 *
 * Skipped in normal CI. Run manually before touching either repo's API:
 *   DAEMON_CONTRACT=1 npm test
 *   DAEMON_CONTRACT=1 DAEMON_URL=http://127.0.0.1:3142 npm test
 *
 * Pinned daemon commit tracked in docs/PROJECT_TRACKER.md (daemon_pin).
 */

import { describe, it, expect } from "vitest";

const DAEMON_URL = process.env.DAEMON_URL ?? "http://127.0.0.1:3142";
const enabled = !!process.env.DAEMON_CONTRACT;

describe.skipIf(!enabled)(
  "daemon contract [live daemon required — set DAEMON_CONTRACT=1]",
  () => {
    it("GET /api/status — reachable and returns a status field", async () => {
      const res = await fetch(`${DAEMON_URL}/api/status`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body.status).toBe("string");
    });

    it("GET /api/groups — returns groups array with jid/name/participants shape", async () => {
      const res = await fetch(`${DAEMON_URL}/api/groups`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { groups: unknown[] };
      expect(Array.isArray(body.groups)).toBe(true);
      for (const g of body.groups) {
        const group = g as Record<string, unknown>;
        expect(typeof group.jid).toBe("string");
        expect(typeof group.name).toBe("string");
        expect(Array.isArray(group.participants)).toBe(true);
        for (const p of group.participants as unknown[]) {
          expect(typeof p).toBe("string");
          expect(p as string).toMatch(/^\+\d+$/);
        }
      }
    });

    it("GET /api/chats/:jid/messages — endpoint exists (200 or 404, not 500)", async () => {
      const jid = "000000000000@s.whatsapp.net";
      const res = await fetch(
        `${DAEMON_URL}/api/chats/${encodeURIComponent(jid)}/messages`
      );
      expect([200, 404]).toContain(res.status);
    });

    it("POST /api/chats/:jid/ack — endpoint exists (200 or 404, not 500)", async () => {
      const jid = "000000000000@s.whatsapp.net";
      const res = await fetch(
        `${DAEMON_URL}/api/chats/${encodeURIComponent(jid)}/ack`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ watermark: 0 }),
        }
      );
      expect([200, 404]).toContain(res.status);
    });
  }
);
