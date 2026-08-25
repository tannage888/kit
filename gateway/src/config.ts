import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  // Supabase — Kit backend
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  // Supabase — Open Brain (optional; disabled when absent)
  OPEN_BRAIN_URL: z.string().url().optional(),
  OPEN_BRAIN_SERVICE_KEY: z.string().min(1).optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().startsWith("sk-ant-"),

  // Gateway
  PORT: z.coerce.number().default(3141),
  CAPTURE_INACTIVITY_MINUTES: z.coerce.number().default(30),

  // Dedicated claude_whatsapp_integration daemon (Kit's own instance)
  EXTERNAL_GATEWAY_URL: z.string().url().default("http://127.0.0.1:3142"),

  // Sweep scheduler
  SWEEP_INTERVAL_HOURS: z.coerce.number().default(3),
  SWEEP_INITIAL_LOOKBACK_DAYS: z.coerce.number().default(7),
  SWEEP_MAX_MESSAGES_PER_CONTACT: z.coerce.number().default(500),
  SWEEP_CONVERSATION_GAP_HOURS: z.coerce.number().default(8),
  // Safety valve for a conversation that never goes quiet: capture it anyway
  // once it has been running this long, rather than never logging it.
  SWEEP_MAX_THREAD_AGE_HOURS: z.coerce.number().default(24),
});

export type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("❌ Invalid environment variables:");
    for (const issue of result.error.issues) {
      console.error(`   ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();
