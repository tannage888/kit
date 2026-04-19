/**
 * Query client — search and filter bound thoughts via Supabase REST API.
 * TypeScript port of openbrain-context/query.py.
 */

import { validateCanonicalName } from "./tags.js";
import { BoundThought, ThoughtType, boundThoughtFromRow } from "./types.js";

const DEFAULT_TIMEOUT = 10_000; // ms

export interface QueryClientOptions {
  supabaseUrl: string;
  supabaseKey: string;
  timeout?: number;
}

export class QueryClient {
  private supabaseUrl: string;
  private supabaseKey: string;
  private timeout: number;

  constructor(opts: QueryClientOptions) {
    this.supabaseUrl = opts.supabaseUrl.replace(/\/+$/, "");
    this.supabaseKey = opts.supabaseKey;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${this.supabaseKey}`,
      "Content-Type": "application/json",
    };
  }

  private async get(params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const url = new URL(`${this.supabaseUrl}/rest/v1/thoughts`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const resp = await fetch(url.toString(), {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!resp.ok) {
      throw new Error(`Supabase query failed: HTTP ${resp.status}`);
    }
    return resp.json() as Promise<Record<string, unknown>[]>;
  }

  /**
   * Get all thoughts bound to an entity, optionally filtered by type and recency.
   */
  async getContext(opts: {
    entity: string;
    thoughtType?: ThoughtType;
    days?: number;
    limit?: number;
  }): Promise<BoundThought[]> {
    validateCanonicalName(opts.entity);
    const params: Record<string, string> = {
      select: "*",
      order: "created_at.desc",
      limit: String(opts.limit ?? 20),
    };

    // Filter by entity in metadata topics using PostgREST containment
    params["metadata->topics"] = `cs.["${opts.entity}"]`;

    if (opts.thoughtType) {
      params["metadata->>type"] = `eq.${opts.thoughtType}`;
    }

    if (opts.days) {
      const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
      params["created_at"] = `gte.${since}`;
    }

    const rows = await this.get(params);
    return rows.map(boundThoughtFromRow);
  }

  /**
   * Get the most recent summary thought for an entity.
   * Returns null if no summary exists.
   */
  async getLatestSummary(entity: string): Promise<BoundThought | null> {
    const results = await this.getContext({
      entity,
      thoughtType: ThoughtType.SUMMARY,
      limit: 1,
    });
    return results[0] ?? null;
  }

  /**
   * Search thoughts by type across all entities.
   * Useful for cross-entity queries like "show all follow-ups".
   */
  async searchByType(opts: {
    thoughtType: ThoughtType;
    days?: number;
    limit?: number;
  }): Promise<BoundThought[]> {
    const params: Record<string, string> = {
      select: "*",
      order: "created_at.desc",
      limit: String(opts.limit ?? 20),
      "metadata->>type": `eq.${opts.thoughtType}`,
    };

    if (opts.days) {
      const since = new Date(Date.now() - opts.days * 86_400_000).toISOString();
      params["created_at"] = `gte.${since}`;
    }

    const rows = await this.get(params);
    return rows.map(boundThoughtFromRow);
  }

  /**
   * Full-text search across thought content with optional entity/type filter.
   */
  async search(opts: {
    query: string;
    entity?: string;
    thoughtType?: ThoughtType;
    limit?: number;
  }): Promise<BoundThought[]> {
    const params: Record<string, string> = {
      select: "*",
      order: "created_at.desc",
      limit: String(opts.limit ?? 10),
      content: `ilike.*${opts.query}*`,
    };

    if (opts.entity) {
      validateCanonicalName(opts.entity);
      params["metadata->topics"] = `cs.["${opts.entity}"]`;
    }

    if (opts.thoughtType) {
      params["metadata->>type"] = `eq.${opts.thoughtType}`;
    }

    const rows = await this.get(params);
    return rows.map(boundThoughtFromRow);
  }
}
