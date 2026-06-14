import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryStore } from "./memory-store.js";

const FAKE_EMBEDDING = Array(384).fill(0.1);

function makeSupabase() {
  const insertFn = vi.fn().mockResolvedValue({ error: null });
  const rpcFn = vi.fn().mockResolvedValue({ data: [], error: null });
  const fromFn = vi.fn().mockReturnValue({ insert: insertFn });
  const schemaMock = { from: fromFn, rpc: rpcFn };
  const supabase = { schema: vi.fn().mockReturnValue(schemaMock) };
  return { supabase, fromFn, insertFn, rpcFn, schemaMock };
}

function makeStore(overrides?: Partial<ReturnType<typeof makeSupabase>>) {
  const mocks = makeSupabase();
  const merged = { ...mocks, ...overrides };
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ embeddings: [FAKE_EMBEDDING] }),
  } as any);
  const store = new MemoryStore(merged.supabase as any, "https://example.supabase.co", "service-key");
  return { store, ...merged };
}

describe("MemoryStore.remember", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("calls kit-embed and inserts a row", async () => {
    const { store, supabase, insertFn } = makeStore();
    await store.remember("Alice works at Corgi", "contact_fact", "chat", "alice-id");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/kit-embed",
      expect.objectContaining({ method: "POST" })
    );
    expect(supabase.schema).toHaveBeenCalledWith("kit");
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Alice works at Corgi",
        category: "contact_fact",
        source: "chat",
        contact_id: "alice-id",
        embedding: expect.stringMatching(/^\[/),
      })
    );
  });

  it("omits contact_id when not provided", async () => {
    const { store, insertFn } = makeStore();
    await store.remember("User prefers mornings", "preference", "manual");
    expect(insertFn).toHaveBeenCalledWith(
      expect.not.objectContaining({ contact_id: expect.anything() })
    );
  });

  it("throws when supabase insert errors", async () => {
    const { supabase } = makeSupabase();
    const insertFn = vi.fn().mockResolvedValue({ error: { message: "db error" } });
    (supabase.schema as any).mockReturnValue({ from: vi.fn().mockReturnValue({ insert: insertFn }), rpc: vi.fn() });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [FAKE_EMBEDDING] }) } as any);
    const store = new MemoryStore(supabase as any, "https://x.supabase.co", "key");
    await expect(store.remember("x", "preference", "chat")).rejects.toThrow("db error");
  });
});

describe("MemoryStore.search", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns memories with similarity > 0.5", async () => {
    const rows = [
      { id: "1", contact_id: "alice", category: "contact_fact", content: "works at Corgi", source: "chat", created_at: "2026-01-01", similarity: 0.9 },
      { id: "2", contact_id: null, category: "preference", content: "likes mornings", source: "manual", created_at: "2026-01-02", similarity: 0.3 },
    ];
    const { supabase, schemaMock } = makeSupabase();
    schemaMock.rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ embeddings: [FAKE_EMBEDDING] }) } as any);
    const store = new MemoryStore(supabase as any, "https://x.supabase.co", "key");
    const results = await store.search("corgi");
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("works at Corgi");
    expect(results[0].similarity).toBe(0.9);
  });

  it("passes contactId filter to rpc", async () => {
    const { store, schemaMock } = makeStore();
    schemaMock.rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await store.search("hello", { contactId: "bob-id", limit: 4 });
    expect(schemaMock.rpc).toHaveBeenCalledWith("search_memories", expect.objectContaining({
      filter_contact_id: "bob-id",
      match_limit: 4,
    }));
  });

  it("throws when rpc errors", async () => {
    const { store, schemaMock } = makeStore();
    schemaMock.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "rpc fail" } });
    await expect(store.search("x")).rejects.toThrow("rpc fail");
  });
});
