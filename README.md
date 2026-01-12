# Medzen Innovations Backend

Backend API server for Medzen Innovations Web App with Supabase integration.

## 🚀 Quick Deploy to Render

**Ready to deploy?** Follow our comprehensive [Deployment Guide](DEPLOYMENT.md) for step-by-step instructions.

Or use our automated configuration:
```bash
# Verify everything is ready
./pre-deploy-check.sh

# Then deploy using render.yaml blueprint
```

## Features

- ✅ Email/Phone OTP authentication
- ✅ Role-based access control (Writer, Reviewer, Admin)
- ✅ User profile management
- ✅ Profile picture upload to Supabase Storage
- ✅ JWT token authentication
- ✅ Secure OTP verification
- ✅ Real-time chat with Socket.IO
- ✅ Ticket management system
- ✅ File upload support
- ✅ Admin dashboard
- ✅ Notifications system

## Setup Instructions

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Supabase

Create a Supabase project at [https://supabase.com](https://supabase.com) and set up the following:

#### Create Tables

Run these SQL commands in your Supabase SQL Editor:

```sql
-- Users table
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'writer' CHECK (role IN ('writer', 'reviewer', 'admin')),
  profile_picture TEXT,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- OTP verifications table
CREATE TABLE otp_verifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  otp_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone);
CREATE INDEX idx_otp_user_id ON otp_verifications(user_id);
CREATE INDEX idx_otp_created_at ON otp_verifications(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;

-- Policies for users table
CREATE POLICY "Users can view their own data" ON users
  FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update their own data" ON users
  FOR UPDATE USING (auth.uid()::text = id::text);

-- Policies for otp_verifications table
CREATE POLICY "Users can view their own OTPs" ON otp_verifications
  FOR SELECT USING (auth.uid()::text = user_id::text);
```

#### Create Storage Bucket

1. Go to Storage in Supabase dashboard
2. Create a new bucket called `user-uploads`
3. Make it public
4. Set up storage policies:

```sql
-- Allow authenticated users to upload their own files
CREATE POLICY "Users can upload their own files" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'user-uploads' AND
    auth.role() = 'authenticated'
  );

-- Allow public read access
CREATE POLICY "Public can view files" ON storage.objects
  FOR SELECT USING (bucket_id = 'user-uploads');

-- Allow users to update their own files
CREATE POLICY "Users can update their own files" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'user-uploads' AND
    auth.role() = 'authenticated'
  );
```

### 3. Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anon public key
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key (for admin operations)
- `JWT_SECRET`: A random secret string for JWT tokens
- `PORT`: Server port (default: 5000)

### 4. Run the Server

Development mode with auto-reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Authentication

#### Send OTP
```http
POST /api/auth/send-otp
Content-Type: application/json

{
  "email": "user@example.com"  // or "phone": "+1234567890"
}
```

#### Verify OTP
```http
POST /api/auth/verify-otp
Content-Type: application/json

{
  "userId": "uuid-here",
  "otp": "123456"
}
```

#### Update Role
```http
PUT /api/auth/role
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "uuid-here",
  "role": "writer"  // or "reviewer", "admin"
}
```

#### Update Name
```http
PUT /api/auth/name
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "uuid-here",
  "name": "John Doe"
}
```

#### Upload Profile Picture
```http
POST /api/auth/profile-picture
Authorization: Bearer <token>
Content-Type: application/json

{
  "userId": "uuid-here",
  "imageBase64": "data:image/png;base64,..."
}
```

## Project Structure

```
backend/
├── config/
│   └── supabase.js          # Supabase client configuration
├── controllers/
│   └── authController.js    # Authentication logic
├── middleware/
│   └── auth.js              # JWT authentication middleware
├── routes/
│   └── auth.js              # API routes
├── utils/
│   ├── otp.js               # OTP generation and verification
│   └── responses.js         # Standard API responses
├── .env.example             # Environment variables template
├── package.json             # Dependencies
├── server.js                # Express server entry point
└── README.md                # This file
```

## Security Notes

- OTPs are hashed before storing in database
- JWT tokens expire after 30 days
- Row Level Security (RLS) enabled on all tables
- Service role key should never be exposed to frontend
- Profile pictures are uploaded to Supabase Storage with proper access policies

## Next Steps

1. Integrate email service (SendGrid, AWS SES) for sending OTP emails
2. Integrate SMS service (Twilio) for sending OTP via SMS
3. Add rate limiting for OTP requests
4. Add refresh token mechanism
5. Add user logout functionality
6. Add password reset flow (optional)
