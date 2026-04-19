/**
 * ContextBinder — main facade for the OpenBrain Context Binding protocol.
 * TypeScript port of openbrain-context/binding.py.
 *
 * Combines capture (write) and query (read) operations behind a single facade.
 */

import { CaptureClient } from "./capture.js";
import { QueryClient } from "./query.js";
import { BoundThought, CaptureResult, ThoughtType } from "./types.js";

export interface ContextBinderOptions {
  supabaseUrl: string;
  supabaseKey: string;
  openbrainUrl?: string;
  timeout?: number;
}

export class ContextBinder {
  private capture: CaptureClient;
  private query: QueryClient;

  constructor(opts: ContextBinderOptions) {
    this.capture = new CaptureClient({
      supabaseUrl: opts.supabaseUrl,
      supabaseKey: opts.supabaseKey,
      openbrainUrl: opts.openbrainUrl,
      timeout: opts.timeout,
    });
    this.query = new QueryClient({
      supabaseUrl: opts.supabaseUrl,
      supabaseKey: opts.supabaseKey,
      timeout: opts.timeout,
    });
  }

  // ── Capture ──────────────────────────────────────────────────────────────────

  /** Capture a bound thought to OpenBrain. */
  async captureThought(opts: {
    content: string;
    entity: string;
    thoughtType: ThoughtType;
    extraTopics?: string[];
    people?: string[];
    actions?: string[];
    source?: string;
  }): Promise<CaptureResult> {
    return this.capture.capture(opts);
  }

  // ── Query ────────────────────────────────────────────────────────────────────

  /** Get all thoughts bound to an entity. */
  async getContext(opts: {
    entity: string;
    thoughtType?: ThoughtType;
    days?: number;
    limit?: number;
  }): Promise<BoundThought[]> {
    return this.query.getContext(opts);
  }

  /** Get the most recent summary thought for an entity. */
  async getLatestSummary(entity: string): Promise<BoundThought | null> {
    return this.query.getLatestSummary(entity);
  }

  /** Search thoughts by type across all entities. */
  async searchByType(opts: {
    thoughtType: ThoughtType;
    days?: number;
    limit?: number;
  }): Promise<BoundThought[]> {
    return this.query.searchByType(opts);
  }

  /** Full-text search with optional entity/type filter. */
  async search(opts: {
    query: string;
    entity?: string;
    thoughtType?: ThoughtType;
    limit?: number;
  }): Promise<BoundThought[]> {
    return this.query.search(opts);
  }
}
