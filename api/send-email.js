/**
 * Vercel Serverless Function: Send Email
 * Simple email sending service called by Render backend
 */

import { createTransport } from "nodemailer";

/**
 * Create nodemailer transporter
 */
const createEmailTransporter = () => {
    return createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        tls: {
            rejectUnauthorized: false,
        },
    });
};

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

    // Handle preflight
    if (req.method === "OPTIONS") {
        res.status(200).end();
        return;
    }

    if (req.method !== "POST") {
        return res.status(405).json({
            success: false,
            message: "Method not allowed"
        });
    }

    try {
        const { to, subject, html, text } = req.body;

        if (!to || !subject || (!html && !text)) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields: to, subject, and html/text",
            });
        }

        // Check if email config exists
        if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.log("⚠️ Email not configured. Would send to:", to);
            return res.status(200).json({
                success: true,
                message: "Email service not configured (logged only)",
                logged: true,
            });
        }

        const transporter = createEmailTransporter();

        const mailOptions = {
            from: `"${process.env.EMAIL_FROM_NAME || "Medzen Innovations"}" <${process.env.SMTP_USER
                }>`,
            to,
            subject,
            html,
            text,
        };

        const info = await transporter.sendMail(mailOptions);

        console.log("✅ Email sent successfully to:", to);

        return res.status(200).json({
            success: true,
            message: "Email sent successfully",
            messageId: info.messageId,
        });
    } catch (error) {
        console.error("❌ Email sending failed:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send email",
            error: error.message,
        });
    }
}
