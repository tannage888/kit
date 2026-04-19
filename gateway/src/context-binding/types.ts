/**
 * Core types for the OpenBrain Context Binding protocol.
 * TypeScript port of openbrain-context (tannage888/openbrain_context_binding).
 */

/** Standardised type tags for bound thoughts. */
export enum ThoughtType {
  SESSION_LOG = "session-log",
  SUMMARY = "summary",
  DECISION = "decision",
  BLOCKER = "blocker",
  NEXT_ACTION = "next-action",
  IDEA = "idea",
  CONTEXT = "context",
  RESOURCE_ADDED = "resource-added",
  INTERACTION = "interaction",
  STATUS_CHANGE = "status-change",
  OBSERVATION = "observation",
}

/** Set of all ThoughtType values for fast lookup. */
export const THOUGHT_TYPE_VALUES = new Set(
  Object.values(ThoughtType) as string[]
);

/** A thought retrieved from OpenBrain with context binding metadata. */
export interface BoundThought {
  id: string;
  content: string;
  entity: string | null;
  thoughtType: ThoughtType | null;
  topics: string[];
  people: string[];
  actions: string[];
  source: string | null;
  createdAt: Date | null;
  similarity: number | null;
  rawMetadata: Record<string, unknown>;
}

/** Result of a thought capture operation. */
export interface CaptureResult {
  success: boolean;
  openbrain: boolean;
  supabaseFallback: boolean;
  error: string | null;
}

/** Metadata structure written to the thoughts table. */
export interface ThoughtMetadata {
  type: string;
  topics: string[];
  people?: string[];
  action_items?: string[];
  source?: string;
  [key: string]: unknown;
}

/** Parse a Supabase row into a BoundThought. */
export function boundThoughtFromRow(row: Record<string, unknown>): BoundThought {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const topics = (metadata.topics ?? []) as string[];
  const typeStr = (metadata.type ?? "") as string;

  // Resolve thought type
  let thoughtType: ThoughtType | null = null;
  for (const tt of Object.values(ThoughtType)) {
    if (tt === typeStr) {
      thoughtType = tt;
      break;
    }
  }

  // Extract entity: first topic that isn't a ThoughtType value
  let entity: string | null = null;
  for (const topic of topics) {
    if (!THOUGHT_TYPE_VALUES.has(topic)) {
      entity = topic;
      break;
    }
  }

  let createdAt: Date | null = null;
  const rawTs = row.created_at as string | undefined;
  if (rawTs) {
    try {
      createdAt = new Date(rawTs);
    } catch {
      // ignore parse errors
    }
  }

  return {
    id: (row.id ?? "") as string,
    content: (row.content ?? "") as string,
    entity,
    thoughtType,
    topics,
    people: (metadata.people ?? []) as string[],
    actions: (metadata.action_items ?? []) as string[],
    source: (metadata.source ?? null) as string | null,
    createdAt,
    similarity: (row.similarity ?? null) as number | null,
    rawMetadata: metadata,
  };
}
