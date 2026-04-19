/**
 * Kit MCP Server
 *
 * Exposes Kit's relationship data to Claude Desktop via the Model Context
 * Protocol. Communicates over stdio — Claude Desktop spawns this process.
 *
 * Usage (in claude_desktop_config.json):
 *   "kit": {
 *     "command": "npx",
 *     "args": ["tsx", "<path>/gateway/src/mcp/server.ts"],
 *     "env": { "SUPABASE_URL": "...", ... }
 *   }
 */

// Env vars are loaded via node --env-file before any module code runs
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  getQueue,
  getContact,
  searchContacts,
  logInteraction,
  addFollowUp,
  completeFollowUp,
  sweepNow,
  createContact,
  setEnergy,
  getEnergy,
  dailyCheckin,
  kitPrepCard,
  kitDraftContext,
  kitReconnectContext,
} from "./tools.js";

// ── Server definition ─────────────────────────────────────────────────────────

const server = new Server(
  { name: "kit", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool registry ─────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_queue",
      description:
        "Returns contacts that are overdue for a catch-up and those due this week. " +
        "Use this to answer 'who should I reach out to?' or 'what's my contact queue?'",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "get_contact",
      description:
        "Returns full details for a single contact including their background, " +
        "recent interactions, open follow-ups, and days overdue. " +
        "Use this when preparing for a conversation or looking someone up.",
      inputSchema: {
        type: "object",
        properties: {
          name_or_id: {
            type: "string",
            description: "Contact name (full or partial) or their ID slug",
          },
        },
        required: ["name_or_id"],
      },
    },
    {
      name: "search_contacts",
      description: "Search contacts by name fragment. Returns all matching contacts.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Name fragment to search for" },
        },
        required: ["query"],
      },
    },
    {
      name: "log_interaction",
      description:
        "Log a conversation or interaction with a contact. " +
        "Updates last_contact, schedules the next action, and writes to Open Brain. " +
        "Use this after any catch-up — in person, call, WhatsApp, etc.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description: "Contact name (full or partial)",
          },
          notes: {
            type: "string",
            description: "What you discussed, how they seemed, anything notable",
          },
          date: {
            type: "string",
            description: "ISO date (YYYY-MM-DD). Defaults to today.",
          },
          channel: {
            type: "string",
            enum: ["in-person", "call", "whatsapp", "email", "other"],
            description: "How you connected. Defaults to 'other'.",
          },
          follow_ups: {
            type: "array",
            items: { type: "string" },
            description: "Any follow-up actions to track (e.g. 'Send the article about X')",
          },
        },
        required: ["contact_name", "notes"],
      },
    },
    {
      name: "add_follow_up",
      description: "Add a follow-up item to a contact's list.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description: "Contact name (full or partial)",
          },
          text: {
            type: "string",
            description: "What needs to be done",
          },
        },
        required: ["contact_name", "text"],
      },
    },
    {
      name: "complete_follow_up",
      description: "Mark a follow-up item as done for a contact.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description: "Contact name (full or partial)",
          },
          follow_up_text: {
            type: "string",
            description: "Text of the follow-up (partial match is fine)",
          },
        },
        required: ["contact_name", "follow_up_text"],
      },
    },
    {
      name: "create_contact",
      description:
        "Create a new contact in Kit: writes the People/*.md file, inserts the DB row, " +
        "and captures an Open Brain observation — all in one step.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name of the contact" },
          tier: {
            type: "number",
            enum: [1, 2, 3],
            description: "1 = Inner Circle, 2 = Active, 3 = Business Contact",
          },
          frequency: {
            type: "string",
            enum: ["Weekly", "Fortnightly", "Monthly", "Quarterly", "Twice Yearly", "Annual"],
            description: "How often to stay in touch",
          },
          origin_story: {
            type: "string",
            description: "Background — how you know them, their role, context",
          },
          notes: {
            type: "string",
            description: "Any additional notes to seed into the contact",
          },
          social_battery_cost: {
            type: "string",
            enum: ["Low", "Medium", "High"],
            description: "How much energy this contact typically takes",
          },
          whatsapp: {
            type: "string",
            description: "WhatsApp number or JID if known",
          },
        },
        required: ["name", "tier", "frequency"],
      },
    },
    {
      name: "sweep_now",
      description:
        "Pull recent WhatsApp conversation history for tracked contacts, " +
        "summarise each conversation with Claude, and record interactions in Kit. " +
        "Updates last_contact and next_action automatically. " +
        "Requires the Kit gateway to be running. " +
        "Use this to catch up on conversations you've had since the last sweep.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description:
              "Optional — sweep only this contact (partial name match). " +
              "Omit to sweep all tracked contacts.",
          },
        },
        required: [],
      },
    },
    {
      name: "kit_set_energy",
      description:
        "Set your social energy level for today. " +
        "This affects which contacts Kit surfaces in /kit-checkin. " +
        "high = full capacity, medium = selective, low = minimal interactions only.",
      inputSchema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["high", "medium", "low"],
            description: "Your social energy level today",
          },
        },
        required: ["level"],
      },
    },
    {
      name: "kit_get_energy",
      description: "Check what energy level is recorded for today.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "kit_reconnect_context",
      description:
        "Returns a reconnection brief for a dormant contact — how you know them, " +
        "last interaction, interests, suggested opener style, and a reassurance message " +
        "to counter anxiety about reaching out after a long gap. " +
        "Use this for contacts with black drift status.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description: "Contact name (full or partial) or their ID",
          },
        },
        required: ["contact_name"],
      },
    },
    {
      name: "kit_prep_card",
      description:
        "Returns a pre-flight brief for a contact — background, interests, sensitive topics, " +
        "open follow-ups, recent interactions, and Open Brain context. " +
        "Use this before reaching out or entering a conversation with someone.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description: "Contact name (full or partial) or their ID",
          },
        },
        required: ["contact_name"],
      },
    },
    {
      name: "kit_draft_context",
      description:
        "Returns context for drafting a message to a contact. " +
        "Includes their background, interests, sensitive topics, last 3 interactions, " +
        "open follow-ups, and time since last contact. " +
        "Optionally pass your intent so Claude can tailor the draft.",
      inputSchema: {
        type: "object",
        properties: {
          contact_name: {
            type: "string",
            description: "Contact name (full or partial) or their ID",
          },
          intent: {
            type: "string",
            description: "What you want to say or ask (optional — Claude will infer from context if omitted)",
          },
        },
        required: ["contact_name"],
      },
    },
    {
      name: "kit_daily_checkin",
      description:
        "Run the daily relationship check-in. Reads today's energy level, loads all active " +
        "contacts, computes drift and safety indicators, surfaces open follow-ups and birthday " +
        "occasions, and returns a prioritised list of contacts to reach out to today. " +
        "Requires energy to be set first via kit_set_energy.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
  ],
}));

// ── Tool dispatch ─────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_queue": {
        const result = await getQueue();
        const lines: string[] = [];

        if (result.overdue.length === 0 && result.due_this_week.length === 0) {
          return text("Your contact queue is clear — no one overdue or due this week.");
        }

        if (result.overdue.length > 0) {
          lines.push(`## Overdue (${result.overdue.length})`);
          for (const c of result.overdue) {
            lines.push(
              `- **${c.name}** — ${c.days_overdue}d overdue` +
              ` (${c.frequency}, Tier ${c.tier})`
            );
          }
        }

        if (result.due_this_week.length > 0) {
          lines.push(`\n## Due This Week (${result.due_this_week.length})`);
          for (const c of result.due_this_week) {
            const label = c.days_overdue <= 0
              ? `due in ${Math.abs(c.days_overdue)}d`
              : `${c.days_overdue}d overdue`;
            lines.push(`- **${c.name}** — ${label} (${c.frequency}, Tier ${c.tier})`);
          }
        }

        return text(lines.join("\n"));
      }

      case "get_contact": {
        const detail = await getContact(String(args?.name_or_id ?? ""));
        if (!detail) return text(`No contact found for "${args?.name_or_id}".`);

        const {
          contact: c, tier_label, days_overdue,
          recent_interactions, open_follow_ups, open_brain_context,
        } = detail;

        const lines: string[] = [
          `# ${c.name}`,
          `**Tier:** ${tier_label} | **Frequency:** ${c.frequency} | **Battery Cost:** ${c.social_battery_cost ?? "unknown"}`,
          `**Last contact:** ${c.last_contact ?? "never"} | **Next action:** ${c.next_action ?? "not set"}${days_overdue > 0 ? ` (${days_overdue}d overdue)` : ""}`,
        ];

        if (c.origin_story) {
          lines.push(`\n**Background:**\n${c.origin_story}`);
        }
        if (c.notes) {
          lines.push(`\n**Notes:**\n${c.notes}`);
        }

        if (open_follow_ups.length > 0) {
          lines.push(`\n**Open Follow-ups (${open_follow_ups.length}):**`);
          for (const fu of open_follow_ups) {
            lines.push(`- ${fu.text}`);
          }
        }

        if (recent_interactions.length > 0) {
          lines.push(`\n**Recent Interactions:**`);
          for (const i of recent_interactions) {
            lines.push(`- ${i.date}${i.channel ? ` (${i.channel})` : ""}: ${i.notes ?? ""}`);
          }
        }

        if (open_brain_context.length > 0) {
          lines.push(`\n**Open Brain Context:**`);
          for (const t of open_brain_context) {
            const prefix = t.date ? `${t.date}` : "";
            const typeTag = t.type ? ` [${t.type}]` : "";
            lines.push(`- ${prefix}${typeTag}: ${t.content}`);
          }
        }

        return text(lines.join("\n"));
      }

      case "search_contacts": {
        const results = await searchContacts(String(args?.query ?? ""));
        if (!results.length) return text(`No contacts found matching "${args?.query}".`);
        const lines = results.map(
          (c) => `- **${c.name}** (${c.id}) — Tier ${c.tier}, ${c.frequency}`
        );
        return text(lines.join("\n"));
      }

      case "log_interaction": {
        const msg = await logInteraction({
          contact_name: String(args?.contact_name ?? ""),
          notes: String(args?.notes ?? ""),
          date: args?.date ? String(args.date) : undefined,
          channel: args?.channel ? String(args.channel) : undefined,
          follow_ups: Array.isArray(args?.follow_ups)
            ? (args.follow_ups as string[])
            : undefined,
        });
        return text(msg);
      }

      case "add_follow_up": {
        const msg = await addFollowUp(
          String(args?.contact_name ?? ""),
          String(args?.text ?? "")
        );
        return text(msg);
      }

      case "complete_follow_up": {
        const msg = await completeFollowUp(
          String(args?.contact_name ?? ""),
          String(args?.follow_up_text ?? "")
        );
        return text(msg);
      }

      case "create_contact": {
        const msg = await createContact({
          name: String(args?.name ?? ""),
          tier: (args?.tier ?? 3) as 1 | 2 | 3,
          frequency: String(args?.frequency ?? "Monthly"),
          origin_story: args?.origin_story ? String(args.origin_story) : undefined,
          notes: args?.notes ? String(args.notes) : undefined,
          social_battery_cost: args?.social_battery_cost ? String(args.social_battery_cost) : undefined,
          whatsapp: args?.whatsapp ? String(args.whatsapp) : undefined,
        });
        return text(msg);
      }

      case "sweep_now": {
        const msg = await sweepNow(
          args?.contact_name ? String(args.contact_name) : undefined
        );
        return text(msg);
      }

      case "kit_set_energy": {
        const msg = await setEnergy(String(args?.level ?? ""));
        return text(msg);
      }

      case "kit_get_energy": {
        const msg = await getEnergy();
        return text(msg);
      }

      case "kit_daily_checkin": {
        const msg = await dailyCheckin();
        return text(msg);
      }

      case "kit_reconnect_context": {
        const msg = await kitReconnectContext(String(args?.contact_name ?? ""));
        return text(msg);
      }

      case "kit_prep_card": {
        const msg = await kitPrepCard(String(args?.contact_name ?? ""));
        return text(msg);
      }

      case "kit_draft_context": {
        const msg = await kitDraftContext(
          String(args?.contact_name ?? ""),
          args?.intent ? String(args.intent) : undefined
        );
        return text(msg);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is reserved for MCP protocol
  process.stderr.write("Kit MCP server running\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
