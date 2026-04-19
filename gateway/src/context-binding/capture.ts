/**
 * Capture client — posts bound thoughts to OpenBrain with Supabase fallback.
 * TypeScript port of openbrain-context/capture.py.
 */

import { buildMetadata, validateCanonicalName } from "./tags.js";
import { CaptureResult, ThoughtMetadata, ThoughtType } from "./types.js";

const DEFAULT_TIMEOUT = 5_000; // ms

export interface CaptureClientOptions {
  supabaseUrl: string;
  supabaseKey: string;
  openbrainUrl?: string;
  timeout?: number;
}

export class CaptureClient {
  private supabaseUrl: string;
  private supabaseKey: string;
  private openbrainUrl: string | null;
  private timeout: number;

  constructor(opts: CaptureClientOptions) {
    this.supabaseUrl = opts.supabaseUrl.replace(/\/+$/, "");
    this.supabaseKey = opts.supabaseKey;
    this.openbrainUrl = opts.openbrainUrl?.replace(/\/+$/, "") ?? null;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  private supabaseHeaders(): Record<string, string> {
    return {
      apikey: this.supabaseKey,
      Authorization: `Bearer ${this.supabaseKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
  }

  /**
   * Capture a bound thought to OpenBrain.
   * Tries the OpenBrain server first (generates embedding + metadata).
   * Falls back to direct Supabase insert if the server is unavailable.
   */
  async capture(opts: {
    content: string;
    entity: string;
    thoughtType: ThoughtType;
    extraTopics?: string[];
    people?: string[];
    actions?: string[];
    source?: string;
  }): Promise<CaptureResult> {
    validateCanonicalName(opts.entity);
    const metadata = buildMetadata({
      entity: opts.entity,
      thoughtType: opts.thoughtType,
      extraTopics: opts.extraTopics,
      people: opts.people,
      actions: opts.actions,
      source: opts.source ?? "api",
    });

    // Try OpenBrain server first
    if (this.openbrainUrl) {
      const result = await this.captureViaOpenbrain(
        opts.content,
        opts.source ?? "api",
        metadata
      );
      if (result.success) return result;
      process.stderr.write(
        `OpenBrain server capture failed (${result.error}), falling back to Supabase\n`
      );
    }

    // Fallback: direct Supabase insert (no embedding)
    return this.captureViaSupabase(opts.content, metadata);
  }

  private async captureViaOpenbrain(
    content: string,
    source: string,
    metadata: ThoughtMetadata
  ): Promise<CaptureResult> {
    try {
      const resp = await fetch(`${this.openbrainUrl}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, source, metadata }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (resp.status < 300) {
        return { success: true, openbrain: true, supabaseFallback: false, error: null };
      }
      const body = await resp.text();
      return {
        success: false,
        openbrain: false,
        supabaseFallback: false,
        error: `HTTP ${resp.status}: ${body.slice(0, 200)}`,
      };
    } catch (err) {
      return {
        success: false,
        openbrain: false,
        supabaseFallback: false,
        error: String(err),
      };
    }
  }

  private async captureViaSupabase(
    content: string,
    metadata: ThoughtMetadata
  ): Promise<CaptureResult> {
    try {
      const resp = await fetch(`${this.supabaseUrl}/rest/v1/thoughts`, {
        method: "POST",
        headers: this.supabaseHeaders(),
        body: JSON.stringify({ content, metadata }),
        signal: AbortSignal.timeout(this.timeout),
      });
      if (resp.status < 300) {
        return { success: true, openbrain: false, supabaseFallback: true, error: null };
      }
      const body = await resp.text();
      return {
        success: false,
        openbrain: false,
        supabaseFallback: false,
        error: `Supabase HTTP ${resp.status}: ${body.slice(0, 200)}`,
      };
    } catch (err) {
      return {
        success: false,
        openbrain: false,
        supabaseFallback: false,
        error: `Supabase error: ${err}`,
      };
    }
  }
}
