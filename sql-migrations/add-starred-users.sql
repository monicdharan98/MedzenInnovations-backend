-- =============================================
-- ADD STARRED USERS FEATURE
-- =============================================
-- This script adds the ability for admins to star/favorite users
-- Run this in your Supabase SQL Editor
-- =============================================

-- ============================================
-- PART 1: Create starred_users table
-- ============================================

CREATE TABLE IF NOT EXISTS starred_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  starred_user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  starred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, starred_user_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_starred_users_user_id ON starred_users(user_id);
CREATE INDEX IF NOT EXISTS idx_starred_users_starred_user_id ON starred_users(starred_user_id);
CREATE INDEX IF NOT EXISTS idx_starred_users_starred_at ON starred_users(starred_at DESC);

-- ============================================
-- PART 2: Add is_starred column to users view (optional)
-- ============================================

-- This is handled in the application layer by joining with starred_users table

-- ============================================
-- PART 3: Set up Row Level Security
-- ============================================

-- Enable RLS
ALTER TABLE starred_users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own starred users" ON starred_users;
DROP POLICY IF EXISTS "Users can star users" ON starred_users;
DROP POLICY IF EXISTS "Users can unstar users" ON starred_users;

-- Create RLS policies
CREATE POLICY "Users can view their own starred users"
  ON starred_users FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can star users"
  ON starred_users FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can unstar users"
  ON starred_users FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================
-- PART 4: Grant permissions
-- ============================================

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, DELETE ON starred_users TO authenticated;

-- Grant all permissions to service_role (for admin operations)
GRANT ALL ON starred_users TO service_role;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
DECLARE
  starred_count INTEGER;
BEGIN
  -- Count records
  SELECT COUNT(*) INTO starred_count FROM starred_users;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ STARRED USERS FEATURE SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Table Created:';
  RAISE NOTICE '  ✅ starred_users (% starred relationships)', starred_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Indexes Created:';
  RAISE NOTICE '  ✅ idx_starred_users_user_id';
  RAISE NOTICE '  ✅ idx_starred_users_starred_user_id';
  RAISE NOTICE '  ✅ idx_starred_users_starred_at';
  RAISE NOTICE '';
  RAISE NOTICE 'RLS Policies:';
  RAISE NOTICE '  ✅ Users can view their own starred users';
  RAISE NOTICE '  ✅ Users can star users';
  RAISE NOTICE '  ✅ Users can unstar users';
  RAISE NOTICE '';
  RAISE NOTICE 'API Endpoints Available:';
  RAISE NOTICE '  POST   /api/admin/users/:userId/star';
  RAISE NOTICE '  DELETE /api/admin/users/:userId/star';
  RAISE NOTICE '  GET    /api/admin/users (with isStarred flag)';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
