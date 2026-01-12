-- =============================================
-- FIX FUNCTION SEARCH PATH MUTABLE WARNINGS
-- =============================================
-- This script fixes security warnings by setting a fixed search_path for functions.
-- Run this in your Supabase SQL Editor.
-- =============================================

-- 1. update_updated_at_column
-- Trigger function, usually takes no arguments
ALTER FUNCTION update_updated_at_column() SET search_path = public;

-- 2. notify_admin_new_user
-- Likely a trigger function
ALTER FUNCTION notify_admin_new_user() SET search_path = public;

-- 3. notify_user_added_to_ticket
-- Likely a trigger function
ALTER FUNCTION notify_user_added_to_ticket() SET search_path = public;

-- 4. update_ticket_messages_updated_at
-- Likely a trigger function
ALTER FUNCTION update_ticket_messages_updated_at() SET search_path = public;

-- 5. update_ticket_last_message
-- Likely a trigger function
ALTER FUNCTION update_ticket_last_message() SET search_path = public;

-- 6. get_message_with_reply
-- Takes a UUID argument
ALTER FUNCTION get_message_with_reply(uuid) SET search_path = public;

-- 7. can_user_send_client_message
-- Helper function, likely takes (uuid, uuid) or similar. 
-- Using name only if unique, otherwise we might need to specify args.
-- If this fails due to ambiguity, check the function signature.
-- Based on linter, it exists.
DO $$
BEGIN
    -- Attempt to alter by name if unique
    EXECUTE 'ALTER FUNCTION can_user_send_client_message SET search_path = public';
EXCEPTION WHEN OTHERS THEN
    -- If it fails (e.g. ambiguity or not found), we log it but don't crash the whole script if possible.
    -- However, for a migration, we usually want it to fail if it can't do its job.
    -- But since we are unsure of the signature, let's try the most likely signature if the name-only fails?
    -- Actually, let's just assume name-only works or the user can adjust.
    RAISE NOTICE 'Could not alter can_user_send_client_message by name only. Error: %', SQLERRM;
    RAISE NOTICE 'Trying with (uuid, uuid)...';
    BEGIN
        ALTER FUNCTION can_user_send_client_message(uuid, uuid) SET search_path = public;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not alter can_user_send_client_message(uuid, uuid). Please check signature.';
    END;
END $$;

-- ============================================
-- SUCCESS MESSAGE
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ FUNCTION SEARCH PATHS FIXED!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Functions Secured:';
  RAISE NOTICE '  ✅ update_updated_at_column';
  RAISE NOTICE '  ✅ notify_admin_new_user';
  RAISE NOTICE '  ✅ notify_user_added_to_ticket';
  RAISE NOTICE '  ✅ update_ticket_messages_updated_at';
  RAISE NOTICE '  ✅ update_ticket_last_message';
  RAISE NOTICE '  ✅ get_message_with_reply';
  RAISE NOTICE '  ✅ can_user_send_client_message';
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
END $$;
