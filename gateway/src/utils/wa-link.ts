/**
 * WhatsApp Deep Link Builder
 *
 * Utility for constructing wa.me deep links (v1.0 integration).
 * Used by the REST API to generate links for the mobile app fallback,
 * and kept here as a reference even though the gateway itself sends
 * via Baileys.
 *
 * Reference: Kit Requirements Spec §6.2
 */

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * Build a wa.me deep link for a contact.
 *
 * @param e164Number Phone number in E.164 format (e.g. "+447700900123")
 * @param message    Optional pre-populated message text
 * @returns          The deep link URL
 * @throws           If the number is not valid E.164
 */
export function buildWhatsAppLink(e164Number: string, message?: string): string {
  if (!E164_REGEX.test(e164Number)) {
    throw new Error(`Invalid E.164 number: "${e164Number}" — expected format: +447700900123`);
  }

  const digits = e164Number.replace(/^\+/, "");
  const base = `https://wa.me/${digits}`;

  if (message) {
    return `${base}?text=${encodeURIComponent(message)}`;
  }

  return base;
}

/**
 * Validate an E.164 phone number.
 */
export function isValidE164(number: string): boolean {
  return E164_REGEX.test(number);
}
