import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageRouter } from "./message-router.js";
import type { TrackedContact, WhatsAppMessage } from "../types.js";

vi.mock("../config.js", () => ({
  config: {
    CAPTURE_INACTIVITY_MINUTES: 30,
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const JID = "447700900001@s.whatsapp.net";

function makeContact(overrides: Partial<TrackedContact> = {}): TrackedContact {
  return {
    id: "contact-1",
    name: "Alice",
    whatsapp: "+447700900001",
    tier: 1,
    wa_capture: "on_demand",
    frequency: "Monthly",
    frequency_days: 30,
    last_contact: "2026-03-01",
    whatsapp_capture: "enabled",
    ...overrides,
  };
}

function makeMsg(overrides: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return {
    remoteJid: JID,
    fromMe: false,
    body: "Hello there",
    timestamp: Date.now(),
    messageId: "msg-1",
    ...overrides,
  };
}

function makeRouter(contact: TrackedContact | null) {
  const mockContacts = {
    getByJid: vi.fn().mockReturnValue(contact),
    getById: vi.fn().mockReturnValue(contact),
  };
  const mockCapture = {
    process: vi.fn().mockResolvedValue(undefined),
  };
  const router = new MessageRouter(mockContacts as any, mockCapture as any);
  return { router, mockContacts, mockCapture };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MessageRouter — whatsapp_capture filtering", () => {
  it("drops message when whatsapp_capture is disabled", () => {
    const contact = makeContact({ whatsapp_capture: "disabled" });
    const { router, mockCapture } = makeRouter(contact);

    router.handleMessage(makeMsg());

    // Thread was never buffered — activeThreadCount stays 0
    expect(router.activeThreadCount).toBe(0);
    // Capture process was never called
    expect(mockCapture.process).not.toHaveBeenCalled();
  });

  it("buffers message when whatsapp_capture is enabled", () => {
    const contact = makeContact({ whatsapp_capture: "enabled", wa_capture: "on_demand" });
    const { router } = makeRouter(contact);

    router.handleMessage(makeMsg());

    expect(router.activeThreadCount).toBe(1);
  });

  it("drops message when contact is unknown (not tracked)", () => {
    const { router } = makeRouter(null);
    router.handleMessage(makeMsg());
    expect(router.activeThreadCount).toBe(0);
  });

  it("drops message when wa_capture is off (regardless of whatsapp_capture)", () => {
    const contact = makeContact({ whatsapp_capture: "enabled", wa_capture: "off" });
    const { router } = makeRouter(contact);

    router.handleMessage(makeMsg());

    expect(router.activeThreadCount).toBe(0);
  });

  it("buffers multiple messages for the same contact", () => {
    const contact = makeContact({ whatsapp_capture: "enabled", wa_capture: "on_demand" });
    const { router } = makeRouter(contact);

    router.handleMessage(makeMsg({ messageId: "msg-1" }));
    router.handleMessage(makeMsg({ messageId: "msg-2" }));
    router.handleMessage(makeMsg({ messageId: "msg-3" }));

    // Still 1 thread (for the same JID), but with 3 messages
    expect(router.activeThreadCount).toBe(1);
  });
});

describe("MessageRouter — triggerCapture options", () => {
  it("forwards source option to capture.process so import card can be tagged", async () => {
    const contact = makeContact({ wa_capture: "on_demand" });
    const { router, mockCapture } = makeRouter(contact);

    router.handleMessage(makeMsg());

    const ok = await router.triggerCapture("contact-1", { source: "zip-import" });

    expect(ok).toBe(true);
    expect(mockCapture.process).toHaveBeenCalledWith(
      expect.objectContaining({ contact }),
      { source: "zip-import" }
    );
  });

  it("defaults to no opts when called without a source", async () => {
    const contact = makeContact({ wa_capture: "on_demand" });
    const { router, mockCapture } = makeRouter(contact);

    router.handleMessage(makeMsg());

    await router.triggerCapture("contact-1");

    expect(mockCapture.process).toHaveBeenCalledWith(
      expect.objectContaining({ contact }),
      {}
    );
  });
});
