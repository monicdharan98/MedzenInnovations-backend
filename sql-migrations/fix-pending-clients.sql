-- Fix existing client accounts that are pending approval
-- Run this in Supabase SQL Editor

UPDATE users 
SET 
  approval_status = 'approved',
  approved_at = NOW()
WHERE 
  role = 'client' 
  AND approval_status = 'pending';

-- Verify the update
SELECT email, name, role, approval_status, approved_at 
FROM users 
WHERE role = 'client';
