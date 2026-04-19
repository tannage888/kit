// ── Contact types (mirror of Kit mobile app schema) ────────

export type RelationshipTier = "1-Inner Circle" | "2-Active" | "3-Business Contact";
export type ContactFrequency = "Weekly" | "Monthly" | "Quarterly";
export type BatteryCost = "Low" | "Medium" | "High";
export type CaptureMode = "auto" | "on_demand" | "off";
export type Channel = "whatsapp" | "call" | "in-person" | "email" | "other";
export type Sentiment = "positive" | "neutral" | "draining";

/**
 * A tracked contact — the gateway only needs fields relevant to
 * WhatsApp monitoring. The full contact record lives in Supabase.
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
  whatsapp_capture: "enabled" | "disabled"; // opt-in flag per contact
}

// ── Message types ──────────────────────────────────────────

export interface WhatsAppMessage {
  /** JID of the remote party (e.g. "447700900123@s.whatsapp.net") */
  remoteJid: string;
  /** Whether we sent it (true) or received it (false) */
  fromMe: boolean;
  /** Plain text body — media messages are ignored in v1.1 */
  body: string;
  /** Unix epoch ms */
  timestamp: number;
  /** WhatsApp message ID */
  messageId: string;
}

// ── Conversation thread (assembled for capture) ────────────

export interface ConversationThread {
  contact: TrackedContact;
  messages: WhatsAppMessage[];
  startedAt: number; // epoch ms of first message
  lastActivityAt: number; // epoch ms of most recent message
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
