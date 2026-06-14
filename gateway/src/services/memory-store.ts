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
  private embedUrl: string;

  constructor(
    private supabase: SupabaseClient,
    supabaseUrl: string,
    private serviceKey: string
  ) {
    this.embedUrl = `${supabaseUrl}/functions/v1/kit-embed`;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.embedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.serviceKey}`,
      },
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`kit-embed failed: ${res.status} ${body}`);
    }
    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings;
  }

  async remember(
    content: string,
    category: string,
    source: string,
    contactId?: string
  ): Promise<void> {
    const [embedding] = await this.embedTexts([content]);
    const { error } = await this.supabase
      .schema("kit")
      .from("memories")
      .insert({
        content,
        category,
        source,
        contact_id: contactId ?? null,
        embedding: JSON.stringify(embedding),
      });
    if (error) throw new Error(`memory insert failed: ${error.message}`);
  }

  async search(
    query: string,
    opts: { contactId?: string; limit?: number } = {}
  ): Promise<Memory[]> {
    const [embedding] = await this.embedTexts([query]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (this.supabase.schema("kit") as any).rpc(
      "search_memories",
      {
        query_embedding: embedding,
        contact_id_filter: opts.contactId ?? null,
        match_limit: opts.limit ?? 10,
      }
    );
    if (error) throw new Error(`memory search failed: ${error.message}`);
    const rows = (data ?? []) as Array<{
      id: string;
      contact_id: string | null;
      category: string;
      content: string;
      source: string;
      created_at: string;
      similarity: number;
    }>;
    return rows
      .filter((r) => r.similarity > 0.5)
      .map((r) => ({
        id: r.id,
        contactId: r.contact_id,
        category: r.category,
        content: r.content,
        source: r.source,
        similarity: r.similarity,
        createdAt: r.created_at,
      }));
  }
}
