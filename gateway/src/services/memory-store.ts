import type { SupabaseClient } from "@supabase/supabase-js";

export interface Memory {
  id: string;
  contactId: string | null;
  category: string;
  content: string;
  source: string;
  similarity: number;
  createdAt: string;
}

export class MemoryStore {
  private supabase: SupabaseClient;
  private supabaseUrl: string;
  private serviceKey: string;

  constructor(supabase: SupabaseClient, supabaseUrl: string, serviceKey: string) {
    this.supabase = supabase;
    this.supabaseUrl = supabaseUrl;
    this.serviceKey = serviceKey;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.supabaseUrl}/functions/v1/kit-embed`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.serviceKey}`,
      },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`kit-embed failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings;
  }

  async remember(
    content: string,
    category: "contact_fact" | "life_event" | "preference" | "interaction_insight",
    source: "chat" | "sweep" | "manual",
    contactId?: string
  ): Promise<void> {
    const [embedding] = await this.embed([content]);
    const embeddingStr = `[${embedding.join(",")}]`;
    const row: Record<string, unknown> = { content, category, source, embedding: embeddingStr };
    if (contactId) row.contact_id = contactId;
    const { error } = await this.supabase.schema("kit").from("memories").insert(row);
    if (error) throw new Error(`Failed to store memory: ${error.message}`);
  }

  async search(
    query: string,
    opts?: { contactId?: string; limit?: number }
  ): Promise<Memory[]> {
    const limit = opts?.limit ?? 10;
    const contactId = opts?.contactId ?? null;
    const [embedding] = await this.embed([query]);
    const embeddingStr = `[${embedding.join(",")}]`;

    const { data, error } = await (this.supabase.schema("kit") as any).rpc("search_memories", {
      query_embedding: embeddingStr,
      filter_contact_id: contactId,
      match_limit: limit,
    });

    if (error) throw new Error(`Memory search failed: ${error.message}`);

    return ((data as any[]) ?? [])
      .filter((r) => r.similarity > 0.5)
      .map((r) => ({
        id: r.id,
        contactId: r.contact_id ?? null,
        category: r.category,
        content: r.content,
        source: r.source,
        similarity: r.similarity,
        createdAt: r.created_at,
      }));
  }
}
