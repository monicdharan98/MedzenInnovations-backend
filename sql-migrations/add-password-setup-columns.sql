-- Add columns for password setup token (for users created by admin)
-- Run this migration before deploying the new user creation flow

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS password_setup_token TEXT,
ADD COLUMN IF NOT EXISTS password_setup_token_expiry TIMESTAMP WITH TIME ZONE;

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_users_password_setup_token 
ON users(password_setup_token) 
WHERE password_setup_token IS NOT NULL;

-- Add comment to explain the columns
COMMENT ON COLUMN users.password_setup_token IS 'Token for first-time password setup (used when admin creates user)';
COMMENT ON COLUMN users.password_setup_token_expiry IS 'Expiry time for password setup token (24 hours from creation)';
