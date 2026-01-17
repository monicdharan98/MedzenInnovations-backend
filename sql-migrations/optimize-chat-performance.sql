-- =============================================
-- OPTIMIZE CHAT PERFORMANCE (INDEXES)
-- =============================================
-- Run this in your Supabase SQL Editor to fix slow chat loading.
-- =============================================

-- 1. Optimizes fetching messages for a specific ticket (FILTER)
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id 
ON ticket_messages(ticket_id);

-- 2. Optimizes sorting messages by date (ORDER BY / LIMIT)
CREATE INDEX IF NOT EXISTS idx_ticket_messages_created_at 
ON ticket_messages(created_at DESC);

-- 3. Composite index for fastest likely query (FILTER + SORT)
-- This is the "God Index" for the specific query we run: .eq('ticket_id', id).order('created_at')
CREATE INDEX IF NOT EXISTS idx_ticket_messages_composite 
ON ticket_messages(ticket_id, created_at DESC);

-- 4. Optimizes Membership Checks (RLS & Logic)
-- Used heavily when checking "Can this user see this ticket?"
CREATE INDEX IF NOT EXISTS idx_ticket_members_ticket_user 
ON ticket_members(ticket_id, user_id);

-- 5. Optimizes fetching Sender details (Batch Fetching)
CREATE INDEX IF NOT EXISTS idx_users_id_email 
ON users(id, email);

-- Success Message
DO $$
BEGIN
  RAISE NOTICE '✅ Chat Indexes Applied Successfully! Queries should be fast now.';
END $$;
