-- Phase 3: energy state table for daily social battery tracking
-- One row per day — upserted on set, queried by today's date.

CREATE TABLE IF NOT EXISTS kit.energy_state (
  day   DATE PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('high', 'medium', 'low'))
);
