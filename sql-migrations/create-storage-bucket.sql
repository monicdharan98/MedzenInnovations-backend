-- =============================================
-- CREATE SUPABASE STORAGE BUCKET FOR TICKET FILES
-- =============================================
-- Run this in Supabase SQL Editor
-- This creates a storage bucket for ticket file uploads
-- =============================================

-- Create storage bucket for ticket files
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-files',
  'ticket-files',
  true,  -- Public bucket so files can be accessed via URL
  52428800,  -- 50MB file size limit
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Create storage policy to allow authenticated users to upload
CREATE POLICY "Allow authenticated users to upload ticket files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ticket-files');

-- Create storage policy to allow public read access
CREATE POLICY "Allow public read access to ticket files"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'ticket-files');

-- Create storage policy to allow authenticated users to update their files
CREATE POLICY "Allow authenticated users to update ticket files"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'ticket-files');

-- Create storage policy to allow authenticated users to delete files
CREATE POLICY "Allow authenticated users to delete ticket files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'ticket-files');

-- Verify bucket creation
SELECT id, name, public, file_size_limit 
FROM storage.buckets 
WHERE id = 'ticket-files';

-- =============================================
-- SETUP COMPLETE!
-- =============================================
-- The 'ticket-files' bucket is now ready for use
-- Files will be stored in: tickets/filename.ext
-- =============================================
