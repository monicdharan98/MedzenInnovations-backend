import { createClient } from "@supabase/supabase-js";
import jwt from "jsonwebtoken";
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
 * Hash OTP for comparison
 */
const hashOTP = (otp) => {
    const otpString = String(otp).trim();
    return crypto.createHash("sha256").update(otpString, "utf8").digest("hex");
};

/**
 * Check if OTP is expired
 */
const isOTPExpired = (expiresAt) => {
    return new Date(expiresAt) < new Date();
};

/**
 * Vercel Serverless Function: Verify OTP
 * POST /api/verify-otp or /api/auth/verify-otp
 */
export default async function handler(req, res) {
    // Set CORS headers
    const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "https://medzen-frontend.vercel.app",
        "https://www.medzen-frontend.vercel.app"
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
    if (allowedOrigins.includes(origin)) {
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
        const { userId, otp } = req.body;

        console.log("🔐 OTP Verification attempt:", {
            userId,
            otp: "****",
            otpLength: otp?.length,
        });

        // Validation
        if (!userId || !otp) {
            return res.status(400).json({
                success: false,
                message: "User ID and OTP are required",
            });
        }

        // Get Supabase client
        const db = getSupabaseClient();

        // Get latest OTP record for user from otp_verifications table
        const { data: otpRecord, error: otpError } = await db
            .from("otp_verifications")
            .select("*")
            .eq("user_id", userId)
            .eq("verified", false)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

        console.log("📊 OTP Record from DB:", {
            found: !!otpRecord,
            error: otpError?.message,
        });

        if (otpError || !otpRecord) {
            console.log("❌ No OTP record found");
            return res.status(400).json({
                success: false,
                message: "No OTP found for this user. Please request a new one.",
            });
        }

        // Check if OTP is expired
        if (isOTPExpired(otpRecord.expires_at)) {
            console.log("❌ OTP expired:", {
                expiresAt: otpRecord.expires_at,
                now: new Date().toISOString(),
            });
            return res.status(400).json({
                success: false,
                message: "OTP has expired. Please request a new one.",
            });
        }

        console.log("✅ OTP not expired");

        // Verify OTP
        const otpString = String(otp).trim();
        const providedHash = hashOTP(otpString);
        const isValid = providedHash === otpRecord.otp_hash;

        console.log("🔐 OTP Verification result:", { isValid });

        if (!isValid) {
            console.log("❌ Invalid OTP provided");
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
            });
        }

        console.log("✅ OTP is valid!");

        // Mark OTP as verified
        await db
            .from("otp_verifications")
            .update({ verified: true })
            .eq("id", otpRecord.id);

        // Update user as verified and get user details
        const { data: user, error: updateError } = await db
            .from("users")
            .update({ is_verified: true })
            .eq("id", userId)
            .select()
            .single();

        if (updateError) {
            console.error("Error updating user:", updateError);
            return res.status(500).json({
                success: false,
                message: "Failed to verify user",
                error: updateError.message,
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email, phone: user.phone },
            process.env.JWT_SECRET,
            { expiresIn: "30d" }
        );

        console.log("✅ User verified successfully:", user.id);

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    phone: user.phone,
                    name: user.name,
                    role: user.role,
                    profile_picture: user.profile_picture,
                    isVerified: user.is_verified,
                    approvalStatus: user.approval_status,
                },
            }
        });
    } catch (error) {
        console.error("❌ Verify OTP error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify OTP",
            error: error.message,
        });
    }
}
