-- Remove 'writer' and 'reviewer' roles from users table
-- Only keep: admin, client, employee, freelancer
-- Run this in Supabase SQL Editor

-- Step 1: Check current roles in use
SELECT role, COUNT(*) as count 
FROM users 
GROUP BY role 
ORDER BY count DESC;

-- Step 2: Update any users with 'writer' or 'reviewer' roles to 'client'
-- (Change to appropriate role if needed)
UPDATE users 
SET role = 'client'
WHERE role IN ('writer', 'reviewer');

-- Step 3: Drop the old constraint
ALTER TABLE users 
DROP CONSTRAINT IF EXISTS users_role_check;

-- Step 4: Add new constraint with only 4 roles
ALTER TABLE users
ADD CONSTRAINT users_role_check 
CHECK (role IN ('admin', 'client', 'employee', 'freelancer'));

-- Step 5: Update default role to 'client' instead of 'writer'
ALTER TABLE users 
ALTER COLUMN role SET DEFAULT 'client';

-- Step 6: Verify the changes
SELECT 
  column_name, 
  data_type, 
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'role';

-- Step 7: Verify all current roles are valid
SELECT role, COUNT(*) as count 
FROM users 
GROUP BY role 
ORDER BY role;
