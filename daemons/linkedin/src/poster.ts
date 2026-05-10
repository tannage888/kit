export interface ScrapedMessage {
  fromMe: boolean;
  body: string;
  timestamp: number; // epoch ms
  messageId: string;
}

export async function postMessages(
  gatewayUrl: string,
  contactId: string,
  channel: "linkedin" | "instagram",
  messages: ScrapedMessage[]
): Promise<void> {
  const res = await fetch(`${gatewayUrl}/api/channels/incoming`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, channel, messages }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gateway error ${res.status}: ${body}`);
  }
}
