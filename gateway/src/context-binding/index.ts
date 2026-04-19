/**
 * OpenBrain Context Binding — associate thoughts with named entities using standardised tags.
 * TypeScript port of openbrain-context (tannage888/openbrain_context_binding).
 */

export { ContextBinder, type ContextBinderOptions } from "./binding.js";
export { CaptureClient, type CaptureClientOptions } from "./capture.js";
export { QueryClient, type QueryClientOptions } from "./query.js";
export {
  buildMetadata,
  buildTopics,
  toCanonicalName,
  validateCanonicalName,
} from "./tags.js";
export {
  ThoughtType,
  THOUGHT_TYPE_VALUES,
  boundThoughtFromRow,
  type BoundThought,
  type CaptureResult,
  type ThoughtMetadata,
} from "./types.js";
