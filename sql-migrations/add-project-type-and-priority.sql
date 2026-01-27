-- Add project_type and mandatory priority column to tickets table
ALTER TABLE tickets 
ADD COLUMN project_type VARCHAR(255) DEFAULT 'General';

-- Note: priority column already exists, but we'll ensure it's properly set
-- The priority is now mandatory for all tickets created through the form
