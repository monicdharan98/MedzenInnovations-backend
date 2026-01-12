-- Migration: Add message forwarding support to ticket_messages table
-- Date: 2025-01-XX
-- Description: Adds columns to track forwarded messages, enabling cross-ticket message forwarding with metadata preservation

-- Add forwarding tracking columns to ticket_messages
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID REFERENCES ticket_messages(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS forwarded_from_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

-- Create index for faster forwarding queries
CREATE INDEX IF NOT EXISTS idx_ticket_messages_forwarded_from_message 
ON ticket_messages(forwarded_from_message_id) 
WHERE forwarded_from_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_messages_forwarded_from_ticket 
ON ticket_messages(forwarded_from_ticket_id) 
WHERE forwarded_from_ticket_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN ticket_messages.forwarded_from_message_id IS 'Reference to the original message if this message was forwarded from another ticket';
COMMENT ON COLUMN ticket_messages.forwarded_from_ticket_id IS 'Reference to the ticket where the original message was sent if this message was forwarded';

-- Verification query
SELECT 
  column_name, 
  data_type, 
  column_default, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ticket_messages' 
  AND column_name IN ('forwarded_from_message_id', 'forwarded_from_ticket_id')
ORDER BY column_name;

-- Test query to see forwarded messages
-- SELECT 
--   tm.id,
--   tm.message,
--   tm.forwarded_from_message_id,
--   tm.forwarded_from_ticket_id,
--   om.message as original_message,
--   ot.title as original_ticket_title
-- FROM ticket_messages tm
-- LEFT JOIN ticket_messages om ON tm.forwarded_from_message_id = om.id
-- LEFT JOIN tickets ot ON tm.forwarded_from_ticket_id = ot.id
-- WHERE tm.forwarded_from_message_id IS NOT NULL
-- LIMIT 10;
