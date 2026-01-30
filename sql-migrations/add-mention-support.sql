-- Add mention support to ticket messages
-- This migration adds a column to store mentioned user IDs in messages

-- Add mentioned_users column to ticket_messages table
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS mentioned_users UUID[] DEFAULT NULL;

-- Add index for faster mention queries
CREATE INDEX IF NOT EXISTS idx_ticket_messages_mentioned_users 
ON ticket_messages USING GIN (mentioned_users);

-- Add comment
COMMENT ON COLUMN ticket_messages.mentioned_users IS 'Array of user IDs who were mentioned (@tagged) in this message';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON ticket_messages TO authenticated;
