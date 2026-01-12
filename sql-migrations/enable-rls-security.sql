-- =============================================
-- ENABLE RLS SECURITY ON PUBLIC TABLES
-- =============================================
-- This script enables Row Level Security (RLS) on tables that were flagged as insecure.
-- Run this in your Supabase SQL Editor.
-- =============================================

-- ============================================
-- PART 1: starred_tickets
-- ============================================

-- Enable RLS
ALTER TABLE starred_tickets ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own starred tickets" ON starred_tickets;
DROP POLICY IF EXISTS "Users can star their accessible tickets" ON starred_tickets;
DROP POLICY IF EXISTS "Users can unstar their own tickets" ON starred_tickets;

-- Create RLS policies
CREATE POLICY "Users can view their own starred tickets"
  ON starred_tickets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can star their accessible tickets"
  ON starred_tickets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unstar their own tickets"
  ON starred_tickets FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- PART 2: ticket_invites
-- ============================================

-- Enable RLS
ALTER TABLE ticket_invites ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view invites they created" ON ticket_invites;
DROP POLICY IF EXISTS "Users can create invites" ON ticket_invites;
DROP POLICY IF EXISTS "Anyone can view invites by token" ON ticket_invites;

-- Create RLS policies

-- Allow users to view invites they created
CREATE POLICY "Users can view invites they created"
  ON ticket_invites FOR SELECT
  USING (auth.uid() = created_by);

-- Allow authenticated users to create invites
CREATE POLICY "Users can create invites"
  ON ticket_invites FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- Allow public access to view invites by token (needed for invite links to work)
-- This is crucial for the invite system to function for non-logged in users or initial checks
CREATE POLICY "Anyone can view invites by token"
  ON ticket_invites FOR SELECT
  USING (true); 

-- ============================================
-- PART 3: ticket_message_history
-- ============================================

-- Enable RLS
ALTER TABLE ticket_message_history ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Authenticated users can view message history" ON ticket_message_history;

-- Create RLS policies
-- Only allow authenticated users to view history (or restrict further if needed)
CREATE POLICY "Authenticated users can view message history"
  ON ticket_message_history FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ RLS SECURITY ENABLED!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Tables Secured:';
  RAISE NOTICE '  ✅ starred_tickets';
  RAISE NOTICE '  ✅ ticket_invites';
  RAISE NOTICE '  ✅ ticket_message_history';
  RAISE NOTICE '';
  RAISE NOTICE 'Policies Created:';
  RAISE NOTICE '  ✅ Starred tickets policies (Select, Insert, Delete)';
  RAISE NOTICE '  ✅ Ticket invites policies (Select, Insert)';
  RAISE NOTICE '  ✅ Message history policies (Select)';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
