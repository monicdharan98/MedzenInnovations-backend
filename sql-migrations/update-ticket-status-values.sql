-- Migration: Update ticket status values
-- Changes "In Progress" to "Ongoing"
-- Run this migration to update ticket status constraints

-- First, update any existing tickets with "In Progress" status to "Ongoing"
UPDATE tickets 
SET status = 'Ongoing' 
WHERE status = 'In Progress';

-- Drop the existing check constraint
ALTER TABLE tickets 
DROP CONSTRAINT IF EXISTS tickets_status_check;

-- Add new check constraint with updated status values
ALTER TABLE tickets 
ADD CONSTRAINT tickets_status_check 
CHECK (status IN ('Created', 'Assigned', 'Ongoing', 'Pending with reviewer', 'Pending with client', 'Completed', 'Closed'));

-- Add comment to explain status values
COMMENT ON COLUMN tickets.status IS 'Ticket status: Created, Assigned, Ongoing, Pending with reviewer, Pending with client, Completed, Closed';
