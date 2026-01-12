-- COMPREHENSIVE MIGRATION: Add all missing columns
-- Date: 2025-11-12
-- Description: Adds all missing columns for message features and ticket files

-- ============================================
-- 1. ADD CREATION_FILES COLUMN TO TICKETS
-- ============================================
ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS creation_files JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN tickets.creation_files IS 'Array of file metadata (name, size, type, url) uploaded during ticket creation';

-- ============================================
-- 2. ADD MESSAGE FEATURES COLUMNS
-- ============================================
-- Add reply_to reference
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES ticket_messages(id) ON DELETE SET NULL;

-- Add edit tracking
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT false;

-- Add delete tracking (soft delete)
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- Add file metadata columns
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);

ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS file_size BIGINT;

ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS file_type VARCHAR(100);

-- Add comments
COMMENT ON COLUMN ticket_messages.reply_to IS 'Reference to the message being replied to';
COMMENT ON COLUMN ticket_messages.is_edited IS 'Whether the message has been edited';
COMMENT ON COLUMN ticket_messages.is_deleted IS 'Soft delete flag - message is hidden but preserved';
COMMENT ON COLUMN ticket_messages.file_name IS 'Original name of uploaded file';
COMMENT ON COLUMN ticket_messages.file_size IS 'Size of uploaded file in bytes';
COMMENT ON COLUMN ticket_messages.file_type IS 'MIME type of uploaded file';

-- ============================================
-- 3. ADD MESSAGE FORWARDING COLUMNS
-- ============================================
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS forwarded_from_message_id UUID REFERENCES ticket_messages(id) ON DELETE SET NULL;

ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS forwarded_from_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

-- Add comments
COMMENT ON COLUMN ticket_messages.forwarded_from_message_id IS 'Reference to the original message if this message was forwarded from another ticket';
COMMENT ON COLUMN ticket_messages.forwarded_from_ticket_id IS 'Reference to the ticket where the original message was sent if this message was forwarded';

-- ============================================
-- 4. CREATE INDEXES FOR PERFORMANCE
-- ============================================
-- Index for reply queries
CREATE INDEX IF NOT EXISTS idx_ticket_messages_reply_to 
ON ticket_messages(reply_to) 
WHERE reply_to IS NOT NULL;

-- Index for forwarding queries
CREATE INDEX IF NOT EXISTS idx_ticket_messages_forwarded_from_message 
ON ticket_messages(forwarded_from_message_id) 
WHERE forwarded_from_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_messages_forwarded_from_ticket 
ON ticket_messages(forwarded_from_ticket_id) 
WHERE forwarded_from_ticket_id IS NOT NULL;

-- Index for soft-deleted messages
CREATE INDEX IF NOT EXISTS idx_ticket_messages_is_deleted 
ON ticket_messages(is_deleted) 
WHERE is_deleted = false;

-- Index for edited messages
CREATE INDEX IF NOT EXISTS idx_ticket_messages_is_edited 
ON ticket_messages(is_edited) 
WHERE is_edited = true;

-- ============================================
-- 5. VERIFICATION QUERIES
-- ============================================

-- Check tickets table
SELECT 
  column_name, 
  data_type, 
  column_default, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'tickets' 
  AND column_name = 'creation_files'
ORDER BY column_name;

-- Check ticket_messages table - new columns
SELECT 
  column_name, 
  data_type, 
  column_default, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'ticket_messages' 
  AND column_name IN (
    'reply_to', 
    'is_edited', 
    'is_deleted',
    'file_name',
    'file_size',
    'file_type',
    'forwarded_from_message_id', 
    'forwarded_from_ticket_id'
  )
ORDER BY column_name;

-- Check indexes
SELECT 
  indexname, 
  indexdef
FROM pg_indexes
WHERE tablename = 'ticket_messages'
  AND indexname LIKE 'idx_ticket_messages_%'
ORDER BY indexname;

-- ============================================
-- MIGRATION COMPLETE
-- ============================================
-- Run this entire SQL script in your Supabase SQL Editor
-- All columns and indexes will be created if they don't exist
