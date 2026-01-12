-- =============================================
-- ADD MESSAGE SEEN BY TRACKING
-- =============================================
-- This script adds the ability to track who has seen each message
-- Run this in your Supabase SQL Editor
-- =============================================

-- Create the message_seen_by table
CREATE TABLE IF NOT EXISTS message_seen_by (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID REFERENCES ticket_messages(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_message_seen_by_message ON message_seen_by(message_id);
CREATE INDEX IF NOT EXISTS idx_message_seen_by_user ON message_seen_by(user_id);
CREATE INDEX IF NOT EXISTS idx_message_seen_by_seen_at ON message_seen_by(seen_at DESC);

-- Enable RLS
ALTER TABLE message_seen_by ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can see who viewed messages in tickets they're members of
CREATE POLICY "Users can view seen status for their tickets"
ON message_seen_by FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM ticket_messages tm
    JOIN ticket_members tmem ON tm.ticket_id = tmem.ticket_id
    WHERE tm.id = message_seen_by.message_id
    AND tmem.user_id = auth.uid()
  )
  OR
  EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'
  )
);

-- RLS Policy: Users can insert their own seen records
CREATE POLICY "Users can mark messages as seen"
ON message_seen_by FOR INSERT
WITH CHECK (user_id = auth.uid());

-- =============================================
-- SUCCESS MESSAGE
-- =============================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ MESSAGE SEEN TRACKING SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'New Table Created:';
  RAISE NOTICE '  ✅ message_seen_by';
  RAISE NOTICE '';
  RAISE NOTICE 'Columns:';
  RAISE NOTICE '  - id (UUID, primary key)';
  RAISE NOTICE '  - message_id (reference to ticket_messages)';
  RAISE NOTICE '  - user_id (reference to users)';
  RAISE NOTICE '  - seen_at (timestamp)';
  RAISE NOTICE '';
  RAISE NOTICE 'Indexes Created:';
  RAISE NOTICE '  ✅ idx_message_seen_by_message';
  RAISE NOTICE '  ✅ idx_message_seen_by_user';
  RAISE NOTICE '  ✅ idx_message_seen_by_seen_at';
  RAISE NOTICE '';
  RAISE NOTICE 'RLS Policies:';
  RAISE NOTICE '  ✅ Users can view seen status for their tickets';
  RAISE NOTICE '  ✅ Users can mark messages as seen';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
