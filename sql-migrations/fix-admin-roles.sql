-- Fix Admin Roles for Additional Admins
-- Run this SQL in Supabase SQL Editor

-- Step 1: Check current status of the two admin users
SELECT 
  id, 
  email, 
  name, 
  role, 
  approval_status,
  created_at
FROM users 
WHERE email IN ('dharanmonic@gmail.com', 'rithikdharan@gmail.com');

-- Step 2: Update both users to admin role with approved status
UPDATE users 
SET 
  role = 'admin', 
  approval_status = 'approved'
WHERE email IN ('dharanmonic@gmail.com', 'rithikdharan@gmail.com');

-- Step 3: Verify all three admins are properly set
SELECT 
  id, 
  email, 
  name, 
  role, 
  approval_status,
  created_at
FROM users 
WHERE role = 'admin'
ORDER BY email;

-- Expected Result: You should see 3 admins:
-- 1. shilpakumarii23051@gmail.com (Shilpa Kumari) - role: admin, approval_status: approved
-- 2. dharanmonic@gmail.com - role: admin, approval_status: approved
-- 3. rithikdharan@gmail.com - role: admin, approval_status: approved

-- Step 4: If users don't exist, create them (uncomment and modify as needed)
/*
INSERT INTO users (email, name, role, approval_status, password_hash, is_verified)
VALUES 
  ('dharanmonic@gmail.com', 'Dharan Monic', 'admin', 'approved', 'TEMPORARY_HASH', true),
  ('rithikdharan@gmail.com', 'Rithik Dharan', 'admin', 'approved', 'TEMPORARY_HASH', true)
ON CONFLICT (email) DO UPDATE 
SET 
  role = 'admin',
  approval_status = 'approved';
*/

-- Note: After running this SQL, affected admin users should:
-- 1. Log out of the application
-- 2. Log back in (to refresh their JWT token with new role)
-- 3. Test delete functionality on any message

-- ============================================
-- VERIFY AND FIX CASCADE DELETE CONSTRAINTS
-- ============================================

-- This section ensures when a ticket is deleted, all related data is automatically deleted

-- Step 1: Check Current Foreign Key Constraints
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.constraint_schema
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('ticket_members', 'ticket_messages', 'ticket_files', 'starred_tickets')
  AND ccu.table_name = 'tickets'
ORDER BY tc.table_name, tc.constraint_name;

-- Step 2: Fix ticket_members if needed
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc 
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'ticket_members'
      AND rc.delete_rule != 'CASCADE'
      AND tc.constraint_name LIKE '%ticket_id%'
  ) THEN
    ALTER TABLE ticket_members 
    DROP CONSTRAINT IF EXISTS ticket_members_ticket_id_fkey;
    
    ALTER TABLE ticket_members
    ADD CONSTRAINT ticket_members_ticket_id_fkey 
    FOREIGN KEY (ticket_id) 
    REFERENCES tickets(id) 
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Fixed ticket_members foreign key constraint';
  ELSE
    RAISE NOTICE 'ticket_members constraint already has CASCADE';
  END IF;
END $$;

-- Step 3: Fix ticket_messages if needed
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc 
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'ticket_messages'
      AND rc.delete_rule != 'CASCADE'
      AND tc.constraint_name LIKE '%ticket_id_fkey'
      AND tc.constraint_name NOT LIKE '%forwarded%'
  ) THEN
    ALTER TABLE ticket_messages 
    DROP CONSTRAINT IF EXISTS ticket_messages_ticket_id_fkey;
    
    ALTER TABLE ticket_messages
    ADD CONSTRAINT ticket_messages_ticket_id_fkey 
    FOREIGN KEY (ticket_id) 
    REFERENCES tickets(id) 
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Fixed ticket_messages foreign key constraint';
  ELSE
    RAISE NOTICE 'ticket_messages constraint already has CASCADE';
  END IF;
END $$;

-- Step 4: Fix ticket_files if needed
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc 
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'ticket_files'
      AND rc.delete_rule != 'CASCADE'
      AND tc.constraint_name LIKE '%ticket_id%'
  ) THEN
    ALTER TABLE ticket_files 
    DROP CONSTRAINT IF EXISTS ticket_files_ticket_id_fkey;
    
    ALTER TABLE ticket_files
    ADD CONSTRAINT ticket_files_ticket_id_fkey 
    FOREIGN KEY (ticket_id) 
    REFERENCES tickets(id) 
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Fixed ticket_files foreign key constraint';
  ELSE
    RAISE NOTICE 'ticket_files constraint already has CASCADE';
  END IF;
END $$;

-- Step 5: Fix starred_tickets if needed
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.referential_constraints rc
    JOIN information_schema.table_constraints tc 
      ON rc.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'starred_tickets'
      AND rc.delete_rule != 'CASCADE'
      AND tc.constraint_name LIKE '%ticket_id%'
  ) THEN
    ALTER TABLE starred_tickets 
    DROP CONSTRAINT IF EXISTS starred_tickets_ticket_id_fkey;
    
    ALTER TABLE starred_tickets
    ADD CONSTRAINT starred_tickets_ticket_id_fkey 
    FOREIGN KEY (ticket_id) 
    REFERENCES tickets(id) 
    ON DELETE CASCADE;
    
    RAISE NOTICE 'Fixed starred_tickets foreign key constraint';
  ELSE
    RAISE NOTICE 'starred_tickets constraint already has CASCADE';
  END IF;
END $$;

-- Step 6: Verify All Constraints are Fixed
SELECT 
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  rc.delete_rule,
  CASE 
    WHEN rc.delete_rule = 'CASCADE' THEN '✅ CORRECT'
    WHEN rc.delete_rule = 'SET NULL' AND kcu.column_name = 'forwarded_from_ticket_id' THEN '✅ CORRECT (SET NULL for forwarded)'
    ELSE '❌ NEEDS FIX'
  END as status
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON rc.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('ticket_members', 'ticket_messages', 'ticket_files', 'starred_tickets')
  AND ccu.table_name = 'tickets'
ORDER BY tc.table_name;

-- Expected Results:
-- ticket_members.ticket_id -> CASCADE ✅
-- ticket_messages.ticket_id -> CASCADE ✅
-- ticket_messages.forwarded_from_ticket_id -> SET NULL ✅ (keeps forwarded messages when source is deleted)
-- ticket_files.ticket_id -> CASCADE ✅
-- starred_tickets.ticket_id -> CASCADE ✅

-- Summary:
-- When a ticket is deleted, the following happens automatically:
-- 1. ticket_members - All members removed (CASCADE)
-- 2. ticket_messages - All messages deleted (CASCADE)
-- 3. ticket_files - All file records deleted (CASCADE)
-- 4. starred_tickets - All stars removed (CASCADE)
-- 5. Files in Supabase Storage - Deleted by backend code
-- 6. Socket notifications - Sent to all members by backend code
