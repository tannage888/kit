# Kit WhatsApp Gateway

Local Node.js server that connects your WhatsApp account to Kit via the Baileys library. Enables full send/receive and automatic conversation capture (FR-07 + FR-13).

## What it does

- **Connects to WhatsApp** via QR code scan (same as WhatsApp Web)
- **Monitors incoming/outgoing messages** for your tracked Kit contacts
- **Captures conversations** automatically (or on-demand) when a thread goes quiet
- **Summarises** conversations using Claude and writes them to Open Brain
- **Exposes a REST API** for the Kit mobile app to send messages, trigger captures, and review summaries

## Architecture

```
┌─────────────┐      ┌──────────────────────┐      ┌─────────────┐
│  Kit Mobile  │◄────►│  Gateway (this repo) │◄────►│  WhatsApp   │
│     App      │ REST │                      │Baileys│   Servers   │
└─────────────┘  API │  ┌─────────────────┐ │      └─────────────┘
                      │  │ Message Router  │ │
                      │  │ Capture Pipeline│ │
                      │  └────────┬────────┘ │
                      └───────────┼──────────┘
                                  │
                    ┌─────────────┼─────────────┐
                    ▼                           ▼
              ┌───────────┐              ┌────────────┐
              │ Open Brain│              │  Claude AI │
              │ (Supabase)│              │ (Anthropic)│
              └───────────┘              └────────────┘
```

## Setup

### Prerequisites

- Node.js 20+
- A WhatsApp account (personal, not Business)
- Supabase projects for Kit backend and Open Brain
- Anthropic API key

### Install

```bash
cd gateway
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env with your Supabase URLs, service keys, and Anthropic API key
```

### Run

```bash
# Development (hot reload)
npm run dev

# Production
npm start
```

On first run, a QR code appears in the terminal. Scan it with WhatsApp → Settings → Linked Devices → Link a Device.

Auth state is saved to `auth_state/` so you only scan once.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Gateway status (connection, tracked contacts, threads) |
| POST | `/api/send` | Send a message via Baileys |
| POST | `/api/deep-link` | Generate a wa.me deep link (v1.0 fallback) |
| GET | `/api/contacts` | List tracked contacts |
| POST | `/api/contacts/refresh` | Reload contacts from Supabase |
| POST | `/api/contacts/register` | Register a contact for tracking |
| DELETE | `/api/contacts/:id` | Remove a contact from tracking |
| PUT | `/api/contacts/:id/capture-mode` | Set capture mode (auto/on_demand/off) |
| POST | `/api/capture/:contactId` | Trigger capture for current thread |
| POST | `/api/capture/:contactId/message/:messageId` | Capture a single message |
| GET | `/api/captures/pending` | List all pending capture reviews |
| GET | `/api/captures/pending/:contactId` | Get a specific pending review |
| POST | `/api/captures/confirm/:contactId` | Confirm a capture → writes to Open Brain |
| POST | `/api/captures/dismiss/:contactId` | Dismiss a capture → nothing stored |

## Capture Modes (per contact)

| Mode | Behaviour |
|------|-----------|
| `auto` | Thread summarised automatically after 30 min inactivity; user reviews before storage |
| `on_demand` | No auto capture; user triggers via API or Kit app |
| `off` | No capture, no monitoring — contact excluded entirely |

## Deployment

Designed to run on a persistent host: home server, Raspberry Pi, or a cheap VPS (£3.50/mo). Must stay running to maintain the WhatsApp Web connection.

For remote access from the Kit mobile app, tunnel via Tailscale or Cloudflare Tunnel.

## ToS Note

Baileys uses the WhatsApp Web protocol. Personal assistant use at low volume has not historically triggered bans, but this is not officially sanctioned by Meta. See Kit Requirements Spec §6.3 for full risk assessment.
