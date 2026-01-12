-- =============================================
-- MEDZEN - ADD PAYMENT STAGES TO TICKETS
-- =============================================
-- This migration adds a payment_stages JSONB column to track
-- Part A, Statistical Results, and Part B stages
-- Each stage has: notified (bool), completed (bool), notified_at, completed_at
-- =============================================

-- Add payment_stages column to tickets table
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS payment_stages JSONB DEFAULT '{
  "part_a": {"notified": false, "completed": false, "notified_at": null, "completed_at": null},
  "statistical_results": {"notified": false, "completed": false, "notified_at": null, "completed_at": null},
  "part_b": {"notified": false, "completed": false, "notified_at": null, "completed_at": null}
}'::jsonb;

-- Update existing tickets to have the default payment_stages
UPDATE tickets
SET payment_stages = '{
  "part_a": {"notified": false, "completed": false, "notified_at": null, "completed_at": null},
  "statistical_results": {"notified": false, "completed": false, "notified_at": null, "completed_at": null},
  "part_b": {"notified": false, "completed": false, "notified_at": null, "completed_at": null}
}'::jsonb
WHERE payment_stages IS NULL;

-- Add index for querying tickets by payment stage status
CREATE INDEX IF NOT EXISTS idx_tickets_payment_stages ON tickets USING GIN (payment_stages);

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tickets' AND column_name = 'payment_stages';
