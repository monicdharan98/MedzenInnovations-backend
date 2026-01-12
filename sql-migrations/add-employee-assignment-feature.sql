-- Migration: Add Employee Assignment Feature
-- Description: Allow employees to add other employees to tickets
-- Date: 2024-11-27

-- The existing ticket_members table already supports this feature
-- We just need to ensure proper indexes exist for performance

-- Add index for efficient lookups when checking if employee is member of ticket
CREATE INDEX IF NOT EXISTS idx_ticket_members_ticket_user ON ticket_members(ticket_id, user_id);

-- Add index for efficient lookups when getting all tickets for a user
CREATE INDEX IF NOT EXISTS idx_ticket_members_user_ticket ON ticket_members(user_id, ticket_id);

-- Add index for efficient lookups when getting members added by a specific user
CREATE INDEX IF NOT EXISTS idx_ticket_members_added_by ON ticket_members(added_by);

-- Verify the existing structure supports our feature
-- The ticket_members table should have:
-- - id (UUID, PRIMARY KEY)
-- - ticket_id (UUID, REFERENCES tickets(id) ON DELETE CASCADE)
-- - user_id (UUID, REFERENCES users(id) ON DELETE CASCADE) 
-- - added_by (UUID, REFERENCES users(id) ON DELETE SET NULL)
-- - added_at (TIMESTAMP WITH TIME ZONE DEFAULT NOW())
-- - can_message_client (BOOLEAN DEFAULT false)
-- - UNIQUE(ticket_id, user_id)

-- Add a comment to document the new feature
COMMENT ON TABLE ticket_members IS 'Stores ticket membership. Admins can add any user. Employees can add other employees if they are already members of the ticket.';

-- Verify permissions are correct
-- Users should be able to:
-- 1. INSERT into ticket_members (to add members)
-- 2. SELECT from ticket_members (to check membership)
-- 3. DELETE from ticket_members (admins only, for removing members)

-- The existing RLS policies should handle security, but let's document the expected behavior:
-- 1. Admins can add/remove any members to/from any ticket
-- 2. Employees can add other employees to tickets they are members of
-- 3. Clients can only view their own memberships
-- 4. All users can view memberships of tickets they are members of

-- No additional RLS policies needed as the application logic handles permissions