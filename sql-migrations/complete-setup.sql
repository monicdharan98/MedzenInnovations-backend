-- =============================================
-- MEDZEN INNOVATIONS - COMPLETE DATABASE SETUP
-- =============================================
-- Run this ENTIRE file in Supabase SQL Editor
-- This includes: Full Database Setup + Starred Tickets + Admin Users
-- Version: 4.0 (Complete with Star Feature)
-- Date: October 28, 2025
-- ============================================

-- ============================================
-- PART 1: DROP EXISTING OBJECTS (Clean Start)
-- ============================================

-- Drop ticket-related tables first
DROP TABLE IF EXISTS starred_tickets CASCADE;
DROP TABLE IF EXISTS ticket_messages CASCADE;
DROP TABLE IF EXISTS ticket_members CASCADE;
DROP TABLE IF EXISTS ticket_files CASCADE;
DROP TABLE IF EXISTS tickets CASCADE;

-- Drop chat tables
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_members CASCADE;
DROP TABLE IF EXISTS chat_groups CASCADE;

-- Drop other tables
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS admin_actions CASCADE;
DROP TABLE IF EXISTS otp_verifications CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop existing functions
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS notify_admin_new_user() CASCADE;
DROP FUNCTION IF EXISTS notify_user_added_to_ticket() CASCADE;
DROP FUNCTION IF EXISTS update_ticket_messages_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_ticket_last_message() CASCADE;

-- ============================================
-- PART 2: CREATE CORE TABLES
-- ============================================

-- Users table with approval system
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'writer' CHECK (role IN ('admin', 'client', 'employee', 'freelancer', 'writer', 'reviewer')),
  department TEXT,
  password TEXT,
  profile_picture TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  approval_status VARCHAR(20) DEFAULT 'not_set' CHECK (approval_status IN ('not_set', 'pending', 'approved', 'rejected')),
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add comment to columns
COMMENT ON COLUMN users.department IS 'Department name for employee users';
COMMENT ON COLUMN users.password IS 'Hashed password for admin users';

-- Add foreign key constraint for approved_by
ALTER TABLE users
ADD CONSTRAINT fk_approved_by
FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

-- OTP Verifications table
CREATE TABLE otp_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Admin Actions table (for audit logging)
CREATE TABLE admin_actions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action_type VARCHAR(50) NOT NULL CHECK (action_type IN ('approve_user', 'reject_user', 'update_user', 'delete_user')),
  target_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- PART 3: CREATE TICKETS TABLES
-- ============================================

-- Tickets table
CREATE TABLE tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_number VARCHAR(50) UNIQUE NOT NULL,
  uid VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  priority VARCHAR(10) DEFAULT 'P3' CHECK (priority IN ('P1', 'P2', 'P3', 'P4', 'P5')),
  status VARCHAR(50) DEFAULT 'Created' CHECK (status IN ('Created', 'Assigned', 'Ongoing', 'Pending with reviewer', 'Pending with client', 'Completed', 'Closed')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,
  points JSONB DEFAULT '[]'::jsonb,
  creation_files JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ticket Members table (with client messaging permission)
CREATE TABLE ticket_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  added_by UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  can_message_client BOOLEAN DEFAULT false,
  UNIQUE(ticket_id, user_id)
);

-- Ticket Messages table
CREATE TABLE ticket_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
  sender_id UUID REFERENCES users(id) ON DELETE SET NULL NOT NULL,
  message TEXT NOT NULL,
  message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'file', 'image')),
  file_url TEXT,
  message_mode VARCHAR(20) DEFAULT 'internal' CHECK (message_mode IN ('internal', 'client')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ticket Files table
CREATE TABLE ticket_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size BIGINT,
  file_type VARCHAR(100),
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- PART 4: CREATE STARRED TICKETS TABLE
-- ============================================

-- Starred Tickets table (NEW)
CREATE TABLE starred_tickets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ticket_id UUID REFERENCES tickets(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  starred_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(ticket_id, user_id)
);

-- Create indexes for starred_tickets
CREATE INDEX idx_starred_tickets_user_id ON starred_tickets(user_id);
CREATE INDEX idx_starred_tickets_ticket_id ON starred_tickets(ticket_id);
CREATE INDEX idx_starred_tickets_starred_at ON starred_tickets(starred_at);

-- Disable RLS for starred_tickets (backend uses service_role)
ALTER TABLE starred_tickets DISABLE ROW LEVEL SECURITY;

-- ============================================
-- PART 5: CREATE NOTIFICATIONS TABLE
-- ============================================

CREATE TABLE notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  related_id UUID,
  related_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- PART 6: CREATE INDEXES
-- ============================================

-- User indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_approval_status ON users(approval_status);

-- OTP indexes
CREATE INDEX idx_otp_user_id ON otp_verifications(user_id);
CREATE INDEX idx_otp_expires_at ON otp_verifications(expires_at);

-- Ticket indexes
CREATE INDEX idx_tickets_created_by ON tickets(created_by);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_created_at ON tickets(created_at);

-- Ticket member indexes
CREATE INDEX idx_ticket_members_ticket_id ON ticket_members(ticket_id);
CREATE INDEX idx_ticket_members_user_id ON ticket_members(user_id);

-- Ticket message indexes
CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
CREATE INDEX idx_ticket_messages_sender_id ON ticket_messages(sender_id);
CREATE INDEX idx_ticket_messages_created_at ON ticket_messages(created_at);

-- Ticket file indexes
CREATE INDEX idx_ticket_files_ticket_id ON ticket_files(ticket_id);
CREATE INDEX idx_ticket_files_uploaded_by ON ticket_files(uploaded_by);

-- Notification indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_is_read ON notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- ============================================
-- PART 7: CREATE HELPER FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- PART 8: CREATE TRIGGERS
-- ============================================

-- Trigger for users table
CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for tickets table
CREATE TRIGGER update_tickets_updated_at
BEFORE UPDATE ON tickets
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Trigger for ticket_messages table
CREATE TRIGGER update_ticket_messages_updated_at
BEFORE UPDATE ON ticket_messages
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PART 9: GRANT PERMISSIONS
-- ============================================

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON otp_verifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON tickets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ticket_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON admin_actions TO authenticated;
GRANT SELECT, INSERT, DELETE ON starred_tickets TO authenticated;

-- Grant all permissions to service_role (backend)
GRANT ALL ON users TO service_role;
GRANT ALL ON otp_verifications TO service_role;
GRANT ALL ON tickets TO service_role;
GRANT ALL ON ticket_members TO service_role;
GRANT ALL ON ticket_messages TO service_role;
GRANT ALL ON ticket_files TO service_role;
GRANT ALL ON notifications TO service_role;
GRANT ALL ON admin_actions TO service_role;
GRANT ALL ON starred_tickets TO service_role;

-- ============================================
-- PART 10: INSERT ADMIN USERS
-- ============================================

-- Insert admin users with default password: 123456
-- Password hash: $2a$10$rGGWXzJZ.hXvHEZq2QvLJOYxR8jL8KwqQv3JqHxQQKxGNqVE7kXW6
INSERT INTO users (email, name, role, password, is_verified, approval_status, approved_at)
VALUES 
  ('shilpakumarii23051@gmail.com', 'Shilpa Kumari', 'admin', '$2a$10$rGGWXzJZ.hXvHEZq2QvLJOYxR8jL8KwqQv3JqHxQQKxGNqVE7kXW6', true, 'approved', NOW()),
  ('rithikdharan@gmail.com', 'Rithik Dharan', 'admin', '$2a$10$rGGWXzJZ.hXvHEZq2QvLJOYxR8jL8KwqQv3JqHxQQKxGNqVE7kXW6', true, 'approved', NOW()),
  ('dharanmonic@gmail.com', 'Dharan Monic', 'admin', '$2a$10$rGGWXzJZ.hXvHEZq2QvLJOYxR8jL8KwqQv3JqHxQQKxGNqVE7kXW6', true, 'approved', NOW())
ON CONFLICT (email) DO UPDATE SET
  password = EXCLUDED.password,
  is_verified = EXCLUDED.is_verified,
  approval_status = EXCLUDED.approval_status,
  approved_at = EXCLUDED.approved_at;

-- ============================================
-- PART 11: VERIFICATION QUERIES
-- ============================================

-- Verify setup
SELECT 'Users table created' as status, COUNT(*) as admin_count FROM users WHERE role = 'admin';
SELECT 'Tickets table created' as status, COUNT(*) as count FROM tickets;
SELECT 'Starred Tickets table created' as status, COUNT(*) as count FROM starred_tickets;
SELECT 'Notifications table created' as status, COUNT(*) as count FROM notifications;

-- Show admin users
SELECT email, name, role, is_verified, approval_status 
FROM users 
WHERE role = 'admin'
ORDER BY created_at;

-- ============================================
-- SETUP COMPLETE!
-- ============================================
-- 
-- DEFAULT ADMIN CREDENTIALS:
-- Email: shilpakumarii23051@gmail.com
-- Password: 123456
--
-- Email: rithikdharan@gmail.com  
-- Password: 123456
--
-- Email: dharanmonic@gmail.com
-- Password: 123456
--
-- ⚠️ CHANGE THESE PASSWORDS AFTER FIRST LOGIN!
-- ============================================
