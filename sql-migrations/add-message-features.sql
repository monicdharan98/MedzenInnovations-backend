-- =============================================
-- ADD MESSAGE FEATURES: REPLY, EDIT, DELETE
-- =============================================
-- This script adds reply, edit, and delete functionality to messages
-- Run this in your Supabase SQL Editor
-- =============================================

-- ============================================
-- PART 1: Add reply functionality
-- ============================================

-- Add reply_to_message_id column to ticket_messages
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES ticket_messages(id) ON DELETE SET NULL;

-- Add is_deleted column for soft delete
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;

-- Add is_edited column to track edited messages
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;

-- Add deleted_at timestamp
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add deleted_by to track who deleted the message
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Create index for reply lookups
CREATE INDEX IF NOT EXISTS idx_ticket_messages_reply_to ON ticket_messages(reply_to_message_id);

-- Create index for non-deleted messages
CREATE INDEX IF NOT EXISTS idx_ticket_messages_not_deleted ON ticket_messages(is_deleted) WHERE is_deleted = FALSE;

-- ============================================
-- PART 2: Update message_type to support more file types
-- ============================================

-- Drop existing constraint if it exists
ALTER TABLE ticket_messages 
DROP CONSTRAINT IF EXISTS ticket_messages_message_type_check;

-- Add new constraint with more file types
ALTER TABLE ticket_messages 
ADD CONSTRAINT ticket_messages_message_type_check 
CHECK (message_type IN ('text', 'file', 'image', 'video', 'audio', 'document', 'zip', 'other'));

-- ============================================
-- PART 3: Add file metadata columns
-- ============================================

-- Add file_name column to store original filename
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS file_name TEXT;

-- Add file_size column to store file size in bytes
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS file_size BIGINT;

-- Add file_type column to store MIME type
ALTER TABLE ticket_messages 
ADD COLUMN IF NOT EXISTS file_mime_type TEXT;

-- ============================================
-- PART 4: Create function to get message with reply details
-- ============================================

-- Function to get messages with reply information
CREATE OR REPLACE FUNCTION get_message_with_reply(message_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'id', m.id,
    'ticket_id', m.ticket_id,
    'sender_id', m.sender_id,
    'message', m.message,
    'message_type', m.message_type,
    'file_url', m.file_url,
    'file_name', m.file_name,
    'file_size', m.file_size,
    'file_mime_type', m.file_mime_type,
    'message_mode', m.message_mode,
    'is_deleted', m.is_deleted,
    'is_edited', m.is_edited,
    'created_at', m.created_at,
    'updated_at', m.updated_at,
    'reply_to', CASE 
      WHEN m.reply_to_message_id IS NOT NULL THEN
        json_build_object(
          'id', rm.id,
          'sender_id', rm.sender_id,
          'sender_name', ru.name,
          'message', CASE 
            WHEN rm.is_deleted THEN 'Message deleted'
            ELSE rm.message 
          END,
          'message_type', rm.message_type,
          'file_name', rm.file_name,
          'created_at', rm.created_at
        )
      ELSE NULL
    END
  ) INTO result
  FROM ticket_messages m
  LEFT JOIN ticket_messages rm ON m.reply_to_message_id = rm.id
  LEFT JOIN users ru ON rm.sender_id = ru.id
  WHERE m.id = message_id;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 5: Create audit log for message edits/deletes (optional)
-- ============================================

CREATE TABLE IF NOT EXISTS ticket_message_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID REFERENCES ticket_messages(id) ON DELETE CASCADE NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('edit', 'delete', 'restore')),
  previous_content TEXT,
  performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reason TEXT
);

-- Create index for message history lookups
CREATE INDEX IF NOT EXISTS idx_message_history_message_id ON ticket_message_history(message_id);
CREATE INDEX IF NOT EXISTS idx_message_history_performed_at ON ticket_message_history(performed_at DESC);

-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
DECLARE
  message_count INTEGER;
BEGIN
  -- Count messages
  SELECT COUNT(*) INTO message_count FROM ticket_messages;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ MESSAGE FEATURES SETUP COMPLETE!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'New Columns Added to ticket_messages:';
  RAISE NOTICE '  ✅ reply_to_message_id';
  RAISE NOTICE '  ✅ is_deleted';
  RAISE NOTICE '  ✅ is_edited';
  RAISE NOTICE '  ✅ deleted_at';
  RAISE NOTICE '  ✅ deleted_by';
  RAISE NOTICE '  ✅ file_name';
  RAISE NOTICE '  ✅ file_size';
  RAISE NOTICE '  ✅ file_mime_type';
  RAISE NOTICE '';
  RAISE NOTICE 'Message Types Supported:';
  RAISE NOTICE '  ✅ text, file, image, video, audio';
  RAISE NOTICE '  ✅ document, zip, other';
  RAISE NOTICE '';
  RAISE NOTICE 'New Tables:';
  RAISE NOTICE '  ✅ ticket_message_history (audit log)';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions Created:';
  RAISE NOTICE '  ✅ get_message_with_reply()';
  RAISE NOTICE '';
  RAISE NOTICE 'Total messages: %', message_count;
  RAISE NOTICE '';
  RAISE NOTICE 'API Endpoints to Add:';
  RAISE NOTICE '  POST   /api/tickets/:ticketId/messages (with replyToId)';
  RAISE NOTICE '  PUT    /api/tickets/:ticketId/messages/:messageId';
  RAISE NOTICE '  DELETE /api/tickets/:ticketId/messages/:messageId';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
