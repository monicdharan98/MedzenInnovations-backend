-- Migration: Add creation_files column to tickets table
-- Date: 2025-11-12
-- Description: Adds a JSONB column to store file metadata uploaded during ticket creation

-- Add creation_files column if it doesn't exist
ALTER TABLE tickets 
ADD COLUMN IF NOT EXISTS creation_files JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN tickets.creation_files IS 'Array of file metadata (name, size, type, url) uploaded during ticket creation';

-- Verification query
SELECT 
  column_name, 
  data_type, 
  column_default, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'tickets' 
  AND column_name = 'creation_files';

-- Show sample data
SELECT id, ticket_number, title, creation_files
FROM tickets
LIMIT 5;
