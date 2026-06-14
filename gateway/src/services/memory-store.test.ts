import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryStore } from "./memory-store.js";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Fake embedding (384 zeros) ────────────────────────────────────────────────

const FAKE_EMBEDDING = Array(384).fill(0.1);

// ── Fetch mock (kit-embed edge function) ──────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockEmbedOk() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ embeddings: [FAKE_EMBEDDING] }),
    text: async () => "",
  });
}

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockRpc = vi.fn().mockResolvedValue({ data: [], error: null });

function makeSupabaseMock(): SupabaseClient {
  return {
    schema: () => ({
      from: () => ({ insert: mockInsert }),
      rpc: mockRpc,
    }),
  } as unknown as SupabaseClient;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("MemoryStore.remember", () => {
  beforeEach(() => {
    mockInsert.mockResolvedValue({ error: null });
    mockEmbedOk();
  });

  it("calls kit-embed with the content", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await store.remember("Alice likes coffee", "contact_fact", "chat", "contact-1");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/functions/v1/kit-embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ texts: ["Alice likes coffee"] }),
      })
    );
  });

  it("inserts the row into kit.memories", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await store.remember("prefers email", "preference", "manual");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "prefers email",
        category: "preference",
        source: "manual",
        contact_id: null,
      })
    );
  });

  it("stores contactId when provided", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await store.remember("Bob moved to London", "life_event", "sweep", "bob-123");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ contact_id: "bob-123" })
    );
  });

  it("throws when Supabase returns an error", async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: "insert failed" } });
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await expect(store.remember("test", "contact_fact", "chat")).rejects.toThrow(
      "memory insert failed"
    );
  });

  it("throws when embed call fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, text: async () => "unavailable" });
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await expect(store.remember("test", "contact_fact", "chat")).rejects.toThrow(
      "kit-embed failed"
    );
  });
});

describe("MemoryStore.search", () => {
  beforeEach(() => {
    mockEmbedOk();
    mockRpc.mockResolvedValue({ data: [], error: null });
  });

  it("calls kit-embed with the query", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await store.search("who is Alice?");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://test.supabase.co/functions/v1/kit-embed",
      expect.objectContaining({
        body: JSON.stringify({ texts: ["who is Alice?"] }),
      })
    );
  });

  it("calls search_memories RPC with embedded query", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await store.search("coffee preference");
    expect(mockRpc).toHaveBeenCalledWith(
      "search_memories",
      expect.objectContaining({
        query_embedding: FAKE_EMBEDDING,
        contact_id_filter: null,
        match_limit: 10,
      })
    );
  });

  it("passes contactId filter when provided", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await store.search("facts", { contactId: "c-1", limit: 4 });
    expect(mockRpc).toHaveBeenCalledWith(
      "search_memories",
      expect.objectContaining({ contact_id_filter: "c-1", match_limit: 4 })
    );
  });

  it("maps rows to Memory interface", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          id: "mem-1",
          contact_id: "c-1",
          category: "contact_fact",
          content: "Alice likes tea",
          source: "chat",
          created_at: "2026-01-01T00:00:00Z",
          similarity: 0.8,
        },
      ],
      error: null,
    });
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    const results = await store.search("tea");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "mem-1",
      contactId: "c-1",
      category: "contact_fact",
      content: "Alice likes tea",
      similarity: 0.8,
    });
  });

  it("filters out results with similarity <= 0.5", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { id: "1", contact_id: null, category: "preference", content: "high", source: "chat", created_at: "2026-01-01T00:00:00Z", similarity: 0.9 },
        { id: "2", contact_id: null, category: "preference", content: "low", source: "chat", created_at: "2026-01-01T00:00:00Z", similarity: 0.3 },
        { id: "3", contact_id: null, category: "preference", content: "border", source: "chat", created_at: "2026-01-01T00:00:00Z", similarity: 0.5 },
      ],
      error: null,
    });
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    const results = await store.search("test");
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("high");
  });

  it("returns empty array when no rows found", async () => {
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    const results = await store.search("unknown topic");
    expect(results).toEqual([]);
  });

  it("throws when search RPC returns an error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "rpc error" } });
    const store = new MemoryStore(
      makeSupabaseMock(),
      "https://test.supabase.co",
      "service-key"
    );
    await expect(store.search("test")).rejects.toThrow("memory search failed");
  });
});
