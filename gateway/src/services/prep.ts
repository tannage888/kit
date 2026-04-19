/**
 * Conversation prep card and draft context — pure formatting functions.
 *
 * buildPrepCard() and buildDraftContext() take pre-fetched data and return
 * formatted strings. No I/O here — the MCP tool functions in tools.ts
 * do the fetching.
 */

// ── Input types ────────────────────────────────────────────────────────────────

export interface PrepContact {
  id: string;
  name: string;
  tier: number;
  frequency: string;
  last_contact: string | null;
  next_action: string | null;
  social_battery_cost: string | null;
  origin_story: string | null;
  special_interests: string | null;
  sensitive_topics: string | null;
  preferred_channel: string | null;
  notes: string | null;
}

export interface PrepInteraction {
  date: string;
  channel: string | null;
  notes: string | null;
}

export interface PrepFollowUp {
  text: string;
  completed: boolean;
}

export interface PrepBrainContext {
  content: string;
  type: string | null;
  date: string | null;
}

// ── Prep card ─────────────────────────────────────────────────────────────────

export function buildPrepCard(
  contact: PrepContact,
  recentInteractions: PrepInteraction[],
  openFollowUps: PrepFollowUp[],
  brainContext: PrepBrainContext[]
): string {
  const tierLabel = ["", "Inner Circle", "Active", "Business"][contact.tier] ?? `Tier ${contact.tier}`;
  const lines: string[] = [
    `## Pre-flight brief: ${contact.name}`,
    `**Tier:** ${tierLabel} | **Frequency:** ${contact.frequency} | **Battery cost:** ${contact.social_battery_cost ?? "unknown"}`,
    `**Last contact:** ${contact.last_contact ?? "never"} | **Next action:** ${contact.next_action ?? "not set"}`,
    `**Preferred channel:** ${contact.preferred_channel ?? "not set"}`,
    "",
  ];

  if (contact.origin_story) {
    lines.push("### Background");
    lines.push(contact.origin_story);
    lines.push("");
  }

  if (contact.special_interests) {
    lines.push("### Interests & hooks");
    lines.push(contact.special_interests);
    lines.push("");
  }

  if (contact.sensitive_topics) {
    lines.push("### Sensitive topics (avoid)");
    lines.push(contact.sensitive_topics);
    lines.push("");
  }

  if (openFollowUps.length > 0) {
    lines.push(`### Open follow-ups (${openFollowUps.length})`);
    for (const fu of openFollowUps) {
      lines.push(`- ${fu.text}`);
    }
    lines.push("");
  }

  if (recentInteractions.length > 0) {
    lines.push("### Recent interactions");
    for (const i of recentInteractions) {
      const channel = i.channel ? ` (${i.channel})` : "";
      lines.push(`- **${i.date}**${channel}: ${i.notes ?? ""}`);
    }
    lines.push("");
  }

  if (brainContext.length > 0) {
    lines.push("### Open Brain context");
    for (const t of brainContext) {
      const meta = [t.date, t.type].filter(Boolean).join(" ");
      lines.push(`- ${meta ? `[${meta}] ` : ""}${t.content}`);
    }
    lines.push("");
  }

  if (contact.notes) {
    lines.push("### Notes");
    lines.push(contact.notes);
  }

  return lines.join("\n");
}

// ── Draft context ─────────────────────────────────────────────────────────────

export function buildDraftContext(
  contact: PrepContact,
  recentInteractions: PrepInteraction[],
  openFollowUps: PrepFollowUp[],
  brainContext: PrepBrainContext[],
  intent?: string
): string {
  const tierLabel = ["", "Inner Circle", "Active", "Business"][contact.tier] ?? `Tier ${contact.tier}`;
  const timeSince = contact.last_contact
    ? humanTimeSince(contact.last_contact)
    : "no prior contact on record";

  const lines: string[] = [
    `## Draft context: ${contact.name}`,
    "",
    `**Relationship:** ${tierLabel} | **Time since last contact:** ${timeSince}`,
    `**Preferred channel:** ${contact.preferred_channel ?? "not set"}`,
    "",
  ];

  if (intent) {
    lines.push(`**Your intent:** ${intent}`);
    lines.push("");
  }

  if (contact.origin_story) {
    lines.push("**How you know them:**");
    lines.push(contact.origin_story);
    lines.push("");
  }

  if (contact.special_interests) {
    lines.push("**Interests to reference:**");
    lines.push(contact.special_interests);
    lines.push("");
  }

  if (contact.sensitive_topics) {
    lines.push("**Topics to avoid:**");
    lines.push(contact.sensitive_topics);
    lines.push("");
  }

  const interactions = recentInteractions.slice(0, 3);
  if (interactions.length > 0) {
    lines.push("**Recent interactions:**");
    for (const i of interactions) {
      lines.push(`- ${i.date}: ${i.notes ?? ""}`);
    }
    lines.push("");
  }

  const pendingActions = openFollowUps.slice(0, 5);
  if (pendingActions.length > 0) {
    lines.push("**Outstanding follow-ups:**");
    for (const fu of pendingActions) {
      lines.push(`- ${fu.text}`);
    }
    lines.push("");
  }

  const contextItems = brainContext.filter((t) =>
    t.type === "INTERACTION" || t.type === "NEXT_ACTION" || t.type === null
  ).slice(0, 3);
  if (contextItems.length > 0) {
    lines.push("**Open Brain memory:**");
    for (const t of contextItems) {
      lines.push(`- ${t.content}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("Use the above to write a message that feels personal and natural.");
  lines.push("Reference specific details rather than writing generically.");

  return lines.join("\n");
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function humanTimeSince(isoDate: string): string {
  const days = Math.floor(
    (Date.now() - new Date(isoDate).getTime()) / 86_400_000
  );
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} year${days >= 730 ? "s" : ""} ago`;
}
