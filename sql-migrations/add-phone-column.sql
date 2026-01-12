-- =============================================
-- ADD PHONE COLUMN TO USERS TABLE
-- =============================================
-- This migration adds a phone column to store user phone numbers
-- Primarily used for client users
-- =============================================

-- Add phone column to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS phone VARCHAR(20);

-- Add index for phone lookups (optional but recommended)
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);

-- Add comment
COMMENT ON COLUMN users.phone IS 'User phone number (required for clients)';

-- Verify the column was added
SELECT column_name, data_type, character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'users' AND column_name = 'phone';
