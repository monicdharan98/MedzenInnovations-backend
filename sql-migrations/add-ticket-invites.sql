-- Migration: create ticket_invites table for one-time ticket invite links
-- Run this migration before enabling invite links

CREATE TABLE IF NOT EXISTS ticket_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  max_uses integer NOT NULL DEFAULT 1,
  uses integer NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by uuid,
  role text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_invites_token ON ticket_invites(token);
