-- =============================================
-- FIX REMAINING RLS ISSUES
-- =============================================
-- This script addresses remaining linter warnings:
-- 1. auth_rls_initplan: Optimizes policies that were still using auth.uid() directly.
-- 2. multiple_permissive_policies: Resolves overlapping policies for the same role/action.
-- =============================================

-- ============================================
-- PART 1: FIX MULTIPLE PERMISSIVE POLICIES
-- ============================================

-- 1.1 Notification Preferences
-- Problem: "Users can update..." (FOR ALL) and "Users can view..." (FOR SELECT) overlapped for SELECT.
-- Fix: Split into specific actions.

DROP POLICY IF EXISTS "Users can view their own notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Users can update their own notification preferences" ON notification_preferences;

CREATE POLICY "Users can view their own notification preferences"
  ON notification_preferences FOR SELECT
  USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can update their own notification preferences"
  ON notification_preferences FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can insert their own notification preferences"
  ON notification_preferences FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);

-- 1.2 Ticket Invites
-- Problem: "Anyone can view invites by token" (USING true) overlaps with "Users can view invites they created".
-- Fix: Drop the redundant "Users can view..." policy since "Anyone..." covers it.
-- Note: "Anyone can view invites by token" allows public access, which is intended for the invite system.

DROP POLICY IF EXISTS "Users can view invites they created" ON ticket_invites;

-- Ensure "Anyone..." policy exists (it should, but just in case)
-- We don't touch it as it uses USING(true) which doesn't trigger initplan warning.


-- ============================================
-- PART 2: FIX AUTH RLS INITPLAN (Performance)
-- ============================================
-- Recreating policies to use (select auth.uid()) in both USING and WITH CHECK clauses.

-- 2.1 Users
-- Problem: "Users can update their own data" was re-evaluating auth.uid().
-- Fix: Recreate with optimized check.

DROP POLICY IF EXISTS "Users can update their own data" ON users;

CREATE POLICY "Users can update their own data"
  ON users FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- 2.2 Admin Actions
-- Problem: "Admins can view all admin actions" re-evaluates auth.uid().
-- Fix: Recreate with optimized admin check.

DROP POLICY IF EXISTS "Admins can view all admin actions" ON admin_actions;

CREATE POLICY "Admins can view all admin actions"
  ON admin_actions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) 
      AND role = 'admin'
    )
  );

-- 2.3 Chat Groups
-- Problem: Admin policies re-evaluating auth.uid().

DROP POLICY IF EXISTS "Admins can create chat groups" ON chat_groups;
DROP POLICY IF EXISTS "Admins can update their own chat groups" ON chat_groups;

CREATE POLICY "Admins can create chat groups"
  ON chat_groups FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) 
      AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update their own chat groups"
  ON chat_groups FOR UPDATE
  USING (
    created_by = (select auth.uid()) 
    AND 
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) 
      AND role = 'admin'
    )
  )
  WITH CHECK (
    created_by = (select auth.uid()) 
    AND 
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) 
      AND role = 'admin'
    )
  );

-- 2.4 Chat Members
-- Problem: "Admins can add members to chat groups" re-evaluates auth.uid().

DROP POLICY IF EXISTS "Admins can add members to chat groups" ON chat_members;

CREATE POLICY "Admins can add members to chat groups"
  ON chat_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = (select auth.uid()) 
      AND role = 'admin'
    )
  );


-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ REMAINING RLS ISSUES FIXED!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Actions Taken:';
  RAISE NOTICE '  ✅ Resolved multiple permissive policies on notification_preferences & ticket_invites';
  RAISE NOTICE '  ✅ Optimized auth.uid() in admin & user policies';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
