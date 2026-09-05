// ── Contact types (mirror of Kit mobile app schema) ────────

export type RelationshipTier = "1-Inner Circle" | "2-Active" | "3-Business Contact";
export type ContactFrequency =
  | "Weekly"
  | "Fortnightly"
  | "Monthly"
  | "Bi-monthly"
  | "Quarterly"
  | "Twice Yearly"
  | "Annual";
export type BatteryCost = "Low" | "Medium" | "High";
export type CaptureMode = "auto" | "on_demand" | "off";
export type Channel = "whatsapp" | "linkedin" | "instagram" | "call" | "in-person" | "email" | "other";
export type Sentiment = "positive" | "neutral" | "draining";

/**
 * A tracked contact — the gateway only needs fields relevant to
 * message monitoring. The full contact record lives in Supabase.
 */
export interface TrackedContact {
  id: string;
  name: string;
  whatsapp: string; // E.164 format, e.g. "+447700900123"
  tier: number;
  wa_capture: CaptureMode;
  frequency: ContactFrequency;
  frequency_days: number; // 7 | 30 | 90 — used to compute next_action
  last_contact: string; // ISO date
  whatsapp_capture: "enabled" | "disabled";
  linkedin_username: string | null;
  linkedin_capture: "enabled" | "disabled";
  instagram_username: string | null;
  instagram_capture: "enabled" | "disabled";
  whatsapp_groups: string | null; // comma-separated group JIDs
  email: string | null;
  url: string | null;
  active: boolean;
}

// ── Message types ──────────────────────────────────────────

/** Channel-agnostic message — used by LinkedIn, Instagram, and sweep threads */
export interface Message {
  fromMe: boolean;
  body: string;
  timestamp: number; // Unix epoch ms
  messageId: string;
  /**
   * Who sent it. Only meaningful for group threads, where every message
   * would otherwise be misattributed to the tracked contact.
   */
  senderJid?: string;
}

/** WhatsApp-specific message — extends Message with JID for registry lookup */
export interface WhatsAppMessage extends Message {
  remoteJid: string;
}

// ── Conversation thread (assembled for capture) ────────────

export interface ConversationThread {
  contact: TrackedContact;
  messages: Message[];
  startedAt: number; // epoch ms of first message
  lastActivityAt: number; // epoch ms of most recent message
  channel: Channel;
  groupJid?: string; // set when this thread came from a group chat sweep
  groupName?: string; // display name for the group, used as the file section heading
}

// ── Capture result (from Claude summarisation) ─────────────

export interface CaptureResult {
  contactName: string;
  date: string; // ISO date
  topics: string;
  followUps: string;
  sentiment: Sentiment;
  channel: Channel;
  /** Raw summary text for the review card */
  summary: string;
  /** Set when the capture came from a group chat — drives its own file section. */
  groupJid?: string;
  groupName?: string;
}

// ── Open Brain memory ──────────────────────────────────────

export interface OpenBrainMemory {
  content: string;
  metadata: {
    person: string;
    type: "interaction" | "followup" | "fact";
    date: string;
    channel: Channel;
    sentiment?: Sentiment;
    source: "whatsapp-gateway";
  };
}

// ── Sweep types ────────────────────────────────────────────

/** Per-contact sweep watermark stored in wa_sweep_state */
export interface SweepState {
  contact_id: string;
  last_swept_at: string; // ISO timestamp
  last_message_ts: number | null; // epoch ms of last processed message
  messages_found: number;
}

/** Result for a single contact in a sweep run */
export interface ContactSweepResult {
  contactId: string;
  contactName: string;
  messagesFound: number;
  threadsProcessed: number;
  skipped: boolean;
  skipReason?: string;
  error?: string;
}

/** Aggregate result returned by SweepScheduler.runSweep() */
export interface SweepResult {
  startedAt: string;
  completedAt: string;
  contactsSwept: number;
  contactsSkipped: number;
  threadsProcessed: number;
  errors: number;
  details: ContactSweepResult[];
}

// ── Gateway status ─────────────────────────────────────────

export type ConnectionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

export interface GatewayStatus {
  connection: ConnectionStatus;
  trackedContacts: number;
  activeThreads: number;
  pendingCaptures: number;
  uptime: number; // seconds
  lastSweep: string | null; // ISO timestamp of last completed sweep
  nextSweep: string | null; // ISO timestamp of next scheduled sweep
}
