/**
 * Reconnection context — pure formatting.
 *
 * Builds context for reaching out to a dormant contact.
 * Claude uses this to compose a reconnection opener in-chat.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReconnectContact {
  name: string;
  tier: number;
  frequency: string;
  last_contact: string | null;
  origin_story: string | null;
  special_interests: string | null;
  sensitive_topics: string | null;
  preferred_channel: string | null;
  notes: string | null;
}

export interface ReconnectInteraction {
  date: string;
  channel: string | null;
  notes: string | null;
}

// ── Main function ─────────────────────────────────────────────────────────────

export function buildReconnectContext(
  contact: ReconnectContact,
  lastInteractions: ReconnectInteraction[]
): string {
  const tierLabel = ["", "Inner Circle", "Active", "Business"][contact.tier] ?? `Tier ${contact.tier}`;
  const gapHuman = contact.last_contact ? humanGap(contact.last_contact) : "a long time";

  const lines: string[] = [
    `## Reconnection context: ${contact.name}`,
    "",
    `**Tier:** ${tierLabel} | **Normal frequency:** ${contact.frequency}`,
    `**Time since last contact:** ${gapHuman}`,
    `**Preferred channel:** ${contact.preferred_channel ?? "not set"}`,
    "",
    "### Reassurance",
    `It's been ${gapHuman} — but reconnecting is always possible. A warm, low-pressure message that acknowledges the gap works well. There's no social rule against picking up where you left off.`,
    "",
  ];

  if (contact.origin_story) {
    lines.push("### How you know them");
    lines.push(contact.origin_story);
    lines.push("");
  }

  if (contact.special_interests) {
    lines.push("### Interests to reference");
    lines.push(contact.special_interests);
    lines.push("");
  }

  if (contact.sensitive_topics) {
    lines.push("### Topics to avoid");
    lines.push(contact.sensitive_topics);
    lines.push("");
  }

  if (lastInteractions.length > 0) {
    lines.push("### Last interaction");
    const last = lastInteractions[0];
    const channel = last.channel ? ` (${last.channel})` : "";
    lines.push(`${last.date}${channel}: ${last.notes ?? "no notes recorded"}`);
    lines.push("");
  }

  lines.push("### Suggested opener style");
  lines.push(suggestedOpenerStyle(contact, gapHuman));
  lines.push("");
  lines.push("---");
  lines.push("Compose a warm, brief message that acknowledges the gap naturally and opens the door to reconnecting. Keep it light — no pressure.");

  return lines.join("\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanGap(isoDate: string): string {
  const days = Math.floor(
    (Date.now() - new Date(isoDate).getTime()) / 86_400_000
  );
  if (days < 14)  return `${days} days`;
  if (days < 60)  return `${Math.floor(days / 7)} weeks`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  const years = Math.floor(days / 365);
  return `${years} year${years > 1 ? "s" : ""}`;
}

function suggestedOpenerStyle(contact: ReconnectContact, gap: string): string {
  const tier = contact.tier;
  if (tier === 1) {
    return `Inner Circle — be direct and warm. Something like: "Hey, it's been ${gap} — I've been thinking about you. How are you doing?"`;
  }
  if (tier === 2) {
    return `Active contact — reference something specific from last time or a shared interest. E.g., "I came across [X] and thought of you immediately."`;
  }
  return `Business contact — professional but warm. Reference a relevant update or shared context.`;
}
