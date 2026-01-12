-- =============================================
-- COMPLETE NOTIFICATION SYSTEM SETUP
-- =============================================
-- This script sets up the complete notification system with preferences
-- Run this in your Supabase SQL Editor
-- =============================================

-- ============================================
-- PART 1: Create notification_preferences table
-- ============================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  chat_clients BOOLEAN DEFAULT TRUE NOT NULL,
  chat_internal BOOLEAN DEFAULT TRUE NOT NULL,
  status_change BOOLEAN DEFAULT TRUE NOT NULL,
  ticket_creation BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add ticket_assigned column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notification_preferences' 
    AND column_name = 'ticket_assigned'
  ) THEN
    ALTER TABLE notification_preferences ADD COLUMN ticket_assigned BOOLEAN DEFAULT TRUE NOT NULL;
    RAISE NOTICE '✅ Added ticket_assigned column to notification_preferences table';
  ELSE
    RAISE NOTICE '⚠️ Column ticket_assigned already exists in notification_preferences table';
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);

-- ============================================
-- PART 2: Add related_ticket_id to notifications table
-- ============================================

-- Add related_ticket_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notifications' 
    AND column_name = 'related_ticket_id'
  ) THEN
    ALTER TABLE notifications ADD COLUMN related_ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE;
    CREATE INDEX idx_notifications_related_ticket_id ON notifications(related_ticket_id);
    RAISE NOTICE '✅ Added related_ticket_id column to notifications table';
  ELSE
    RAISE NOTICE '⚠️ Column related_ticket_id already exists in notifications table';
  END IF;
END $$;

-- ============================================
-- PART 3: Add indexes for better performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ============================================
-- PART 4: Enable Row Level Security
-- ============================================

-- Enable RLS on notification_preferences
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own notification preferences" ON notification_preferences;
DROP POLICY IF EXISTS "Users can update their own notification preferences" ON notification_preferences;

-- Create RLS policies for notification_preferences
CREATE POLICY "Users can view their own notification preferences"
  ON notification_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notification preferences"
  ON notification_preferences FOR ALL
  USING (auth.uid() = user_id);

-- ============================================
-- PART 5: Grant permissions
-- ============================================

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO authenticated;

-- ============================================
-- PART 6: Create default preferences for existing users
-- ============================================

-- Insert default preferences for all existing users who don't have them
DO $$
BEGIN
  -- Check if ticket_assigned column exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'notification_preferences' 
    AND column_name = 'ticket_assigned'
  ) THEN
    -- Insert with ticket_assigned column
    INSERT INTO notification_preferences (user_id, chat_clients, chat_internal, status_change, ticket_creation, ticket_assigned)
    SELECT 
      id,
      TRUE,
      TRUE,
      TRUE,
      TRUE,
      TRUE
    FROM users
    WHERE id NOT IN (SELECT user_id FROM notification_preferences)
    ON CONFLICT (user_id) DO NOTHING;
  ELSE
    -- Insert without ticket_assigned column (older schema)
    INSERT INTO notification_preferences (user_id, chat_clients, chat_internal, status_change, ticket_creation)
    SELECT 
      id,
      TRUE,
      TRUE,
      TRUE,
      TRUE
    FROM users
    WHERE id NOT IN (SELECT user_id FROM notification_preferences)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
  
  RAISE NOTICE '✅ Created default preferences for existing users';
END $$;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
DECLARE
  pref_count INTEGER;
  notif_count INTEGER;
BEGIN
  -- Count records
  SELECT COUNT(*) INTO pref_count FROM notification_preferences;
  SELECT COUNT(*) INTO notif_count FROM notifications;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ NOTIFICATION SYSTEM SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Tables:';
  RAISE NOTICE '  ✅ notification_preferences (% users configured)', pref_count;
  RAISE NOTICE '  ✅ notifications (% total notifications)', notif_count;
  RAISE NOTICE '';
  RAISE NOTICE 'Indexes Created:';
  RAISE NOTICE '  ✅ idx_notification_preferences_user_id';
  RAISE NOTICE '  ✅ idx_notifications_related_ticket_id';
  RAISE NOTICE '  ✅ idx_notifications_type';
  RAISE NOTICE '  ✅ idx_notifications_user_id';
  RAISE NOTICE '  ✅ idx_notifications_is_read';
  RAISE NOTICE '  ✅ idx_notifications_created_at';
  RAISE NOTICE '';
  RAISE NOTICE 'Available Preferences:';
  RAISE NOTICE '  📱 chat_clients - Messages from clients';
  RAISE NOTICE '  💬 chat_internal - Internal team messages';
  RAISE NOTICE '  🔄 status_change - Ticket status changes';
  RAISE NOTICE '  🎫 ticket_creation - New tickets created';
  RAISE NOTICE '  👤 ticket_assigned - Being added to tickets';
  RAISE NOTICE '';
  RAISE NOTICE 'RLS Policies:';
  RAISE NOTICE '  ✅ Users can view their own preferences';
  RAISE NOTICE '  ✅ Users can update their own preferences';
  RAISE NOTICE '';
  RAISE NOTICE 'API Endpoints:';
  RAISE NOTICE '  GET  /api/notifications/preferences';
  RAISE NOTICE '  PUT  /api/notifications/preferences';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '1. Deploy backend changes to Vercel';
  RAISE NOTICE '2. Implement frontend settings page';
  RAISE NOTICE '3. Test notification preferences';
  RAISE NOTICE '========================================';
END $$;
