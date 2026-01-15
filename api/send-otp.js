import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

// Supabase client will be created lazily
let supabase = null;

const getSupabaseClient = () => {
    if (!supabase) {
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
            throw new Error("Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.");
        }
        supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY
        );
    }
    return supabase;
};

/**
 * Generate a 4-digit OTP
 */
const generateOTP = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Hash OTP for secure storage
 */
const hashOTP = (otp) => {
    const otpString = String(otp).trim();
    return crypto.createHash("sha256").update(otpString, "utf8").digest("hex");
};

/**
 * Calculate OTP expiry time (in minutes)
 */
const getOTPExpiry = (minutes = 10) => {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
};

/**
 * Send email via Vercel email service
 */
const sendEmailViaVercel = async (to, subject, html) => {
    try {
        const emailUrl = process.env.VERCEL_EMAIL_URL || 'https://medzen-backend.vercel.app';
        const response = await fetch(`${emailUrl}/api/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ to, subject, html }),
        });
        return await response.json();
    } catch (error) {
        console.error("Email send error:", error);
        return { success: false, error: error.message };
    }
};

/**
 * Vercel Serverless Function: Send OTP
 * POST /api/send-otp or /api/auth/send-otp
 */
export default async function handler(req, res) {
    // Set CORS headers
    const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "https://medzen-frontend.vercel.app",
        "https://www.medzen-frontend.vercel.app",
        "https://medzen-innovations.vercel.app",
        "https://www.medzen-innovations.vercel.app"
    ];

    // Add any additional origins from environment variable
    if (process.env.FRONTEND_URL) {
        const envOrigins = process.env.FRONTEND_URL.split(",").map(url => url.trim());
        envOrigins.forEach(origin => {
            if (!allowedOrigins.includes(origin)) {
                allowedOrigins.push(origin);
            }
        });
    }

    const origin = req.headers.origin;
    if (origin && (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app"))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    } else {
        res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0]);
    }

    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
    res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization");

    if (req.method === "OPTIONS") {
        res.status(200).end();
        return;
    }

    if (req.method !== "POST") {
        return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    try {
        const { email } = req.body;

        console.log("📧 Send OTP request:", { email });

        // Validation
        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email is required",
            });
        }

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "Invalid email format",
            });
        }

        // Get Supabase client
        const db = getSupabaseClient();

        // Generate OTP
        const otp = generateOTP();
        const otpHash = hashOTP(otp);
        const expiresAt = getOTPExpiry(parseInt(process.env.OTP_EXPIRY_MINUTES || "10"));

        console.log("� Generated OTP:", otp);

        // Check if user exists
        const { data: existingUser, error: userError } = await db
            .from("users")
            .select("id, email, name")
            .eq("email", email.toLowerCase().trim())
            .single();

        if (userError && userError.code !== "PGRST116") {
            // PGRST116 = not found, which is fine
            console.error("Error checking user:", userError);
            return res.status(500).json({
                success: false,
                message: "Database error",
                error: userError.message,
            });
        }

        let userId;

        if (existingUser) {
            // User exists, use existing ID
            userId = existingUser.id;
            console.log("✅ Existing user found:", userId);
        } else {
            // Create new user record with pending approval status
            const { data: newUser, error: createError } = await db
                .from("users")
                .insert([
                    {
                        email: email.toLowerCase().trim(),
                        is_verified: false,
                        approval_status: "pending",
                        created_at: new Date().toISOString(),
                    },
                ])
                .select()
                .single();

            if (createError) {
                console.error("Error creating user:", createError);
                return res.status(500).json({
                    success: false,
                    message: "Failed to create user record",
                    error: createError.message,
                });
            }

            userId = newUser.id;
            console.log("✅ New user created:", userId);
        }

        // Store OTP in otp_verifications table
        const { error: otpError } = await db
            .from("otp_verifications")
            .insert([
                {
                    user_id: userId,
                    otp_hash: otpHash,
                    expires_at: expiresAt,
                    verified: false,
                    created_at: new Date().toISOString(),
                },
            ]);

        if (otpError) {
            console.error("Error storing OTP:", otpError);
            return res.status(500).json({
                success: false,
                message: "Failed to store OTP",
                error: otpError.message,
            });
        }

        // Send OTP via email
        const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: white; padding: 30px; border-radius: 0 0 5px 5px; }
    .otp-box { background-color: #f0f0f0; border: 2px dashed #4CAF50; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 10px; margin: 20px 0; border-radius: 5px; }
    .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
    .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Medzen Innovations</h1>
      <p>Email Verification</p>
    </div>
    <div class="content">
      <h2>Hello!</h2>
      <p>Thank you for signing up with Medzen Innovations. To complete your registration, please use the verification code below:</p>
      <div class="otp-box">${otp}</div>
      <p>This code will expire in <strong>10 minutes</strong>.</p>
      <div class="warning">
        <strong>⚠️ Security Notice:</strong><br>
        Never share this code with anyone. Medzen Innovations will never ask you for this code via phone or email.
      </div>
      <p>If you didn't request this code, please ignore this email or contact our support team.</p>
      <p>Best regards,<br><strong>Medzen Innovations Team</strong></p>
    </div>
    <div class="footer">
      <p>This is an automated message, please do not reply to this email.</p>
      <p>&copy; 2025 Medzen Innovations. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;

        const emailResult = await sendEmailViaVercel(
            email,
            "Your Verification Code - Medzen Innovations",
            emailHtml
        );

        if (!emailResult.success) {
            console.log("⚠️ Email delivery failed but OTP stored:", emailResult.error);
        } else {
            console.log("✅ OTP email sent successfully");
        }

        return res.status(200).json({
            success: true,
            message: emailResult.success
                ? "OTP sent to your email successfully"
                : "OTP generated but email delivery may have failed",
            data: {
                userId,
                expiresAt,
                emailSent: emailResult.success,
            }
        });
    } catch (error) {
        console.error("❌ Send OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send OTP",
            error: error.message,
        });
    }
}
