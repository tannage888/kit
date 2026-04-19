/**
 * Tag validation and topic list building for the context binding protocol.
 * TypeScript port of openbrain-context/tags.py.
 */

import { ThoughtMetadata, ThoughtType } from "./types.js";

/** Canonical names: lowercase letters, digits, hyphens, underscores. Must start with a letter. */
const CANONICAL_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Validate and return a canonical entity name.
 * Throws if the name doesn't match: lowercase, starts with a letter,
 * only letters/digits/hyphens/underscores.
 */
export function validateCanonicalName(name: string): string {
  if (!name) {
    throw new Error("Canonical name must not be empty");
  }
  if (!CANONICAL_RE.test(name)) {
    throw new Error(
      `Invalid canonical name '${name}'. ` +
        "Must be lowercase, start with a letter, and contain only letters, digits, hyphens, or underscores."
    );
  }
  return name;
}

/**
 * Derive a canonical entity name from a display name.
 * e.g. "Graham Boutilier" -> "graham-boutilier"
 */
export function toCanonicalName(displayName: string): string {
  const canonical = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-") // collapse non-alphanumeric runs to hyphens
    .replace(/^-+|-+$/g, "");    // strip leading/trailing hyphens

  return validateCanonicalName(canonical);
}

/**
 * Build a standardised topics list for a bound thought.
 * Always includes the canonical entity name first, then the thought type,
 * then any extra topics. Deduplicates while preserving order.
 */
export function buildTopics(
  entity: string,
  thoughtType: ThoughtType,
  extraTopics?: string[]
): string[] {
  entity = validateCanonicalName(entity);
  const topics: string[] = [entity, thoughtType];
  if (extraTopics) {
    for (const topic of extraTopics) {
      if (topic && !topics.includes(topic)) {
        topics.push(topic);
      }
    }
  }
  return topics;
}

/**
 * Build the full metadata dict for a bound thought.
 * Sets metadata.type for structured queries and includes the type tag
 * in metadata.topics for flexible topic-based queries.
 */
export function buildMetadata(opts: {
  entity: string;
  thoughtType: ThoughtType;
  extraTopics?: string[];
  people?: string[];
  actions?: string[];
  source?: string;
}): ThoughtMetadata {
  const topics = buildTopics(opts.entity, opts.thoughtType, opts.extraTopics);
  const metadata: ThoughtMetadata = {
    type: opts.thoughtType,
    topics,
  };
  if (opts.people?.length) {
    metadata.people = opts.people;
  }
  if (opts.actions?.length) {
    metadata.action_items = opts.actions;
  }
  if (opts.source) {
    metadata.source = opts.source;
  }
  return metadata;
}
