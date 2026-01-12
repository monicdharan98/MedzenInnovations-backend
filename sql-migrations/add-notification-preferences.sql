-- =============================================
-- ADD NOTIFICATION PREFERENCES SYSTEM
-- =============================================
-- This script adds notification preferences functionality
-- Run this in your Supabase SQL Editor

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
  END IF;
END $$;

-- ============================================
-- PART 3: Add index for notification type
-- ============================================

CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);

-- ============================================
-- PART 4: Grant permissions
-- ============================================

-- Enable Row Level Security
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
-- SUCCESS MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '✅ Notification preferences system has been set up successfully!';
  RAISE NOTICE 'Tables created:';
  RAISE NOTICE '  - notification_preferences (with indexes)';
  RAISE NOTICE 'Columns added:';
  RAISE NOTICE '  - notifications.related_ticket_id';
  RAISE NOTICE 'RLS policies created for notification_preferences';
END $$;
