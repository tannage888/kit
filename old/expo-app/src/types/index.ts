export type Tier = 1 | 2 | 3;
export type SocialBatteryCost = 'Low' | 'Medium' | 'High';

export interface Contact {
  id: string;
  name: string;
  tier: Tier;
  frequency: string;
  frequency_days: number;
  last_contact: string | null;   // ISO date YYYY-MM-DD
  next_action: string | null;    // ISO date YYYY-MM-DD
  social_battery_cost: SocialBatteryCost | null;
  origin_story: string | null;
  notes: string | null;
  whatsapp: string | null;       // phone number digits only
  active: number;                // 1 = active, 0 = inactive
}

export interface FollowUp {
  id: string;
  contact_id: string;
  text: string;
  completed: number;  // 0 or 1
  created_at: string;
}

export interface InteractionLog {
  id: string;
  contact_id: string;
  notes: string;
  date: string;       // ISO date YYYY-MM-DD
  created_at: string;
}

export interface ContactWithStatus extends Contact {
  days_overdue: number;   // negative = upcoming
}
