/**
 * Email Service Wrapper
 * Calls Vercel email service instead of sending directly
 * Falls back to local sending if Vercel URL not configured
 */

import { createTransport } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// Vercel email service URL
const VERCEL_EMAIL_SERVICE = process.env.VERCEL_EMAIL_URL || null;

/**
 * Get the production frontend URL
 */
const getFrontendUrl = () => {
  const frontendUrls = process.env.FRONTEND_URL || "http://localhost:5173";
  const urls = frontendUrls.split(",").map((url) => url.trim());
  const productionUrl = urls.find((url) => !url.includes("localhost"));
  return productionUrl || urls[0];
};

/**
 * Create nodemailer transporter (fallback for local development)
 */
const createTransporter = () => {
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

/**
 * Send email via Vercel service or fallback to direct sending
 */
export const sendEmail = async (to, subject, html, text = null) => {
  try {
    // If Vercel email service is configured, use it
    if (VERCEL_EMAIL_SERVICE) {
      console.log("📧 Sending email via Vercel service:", VERCEL_EMAIL_SERVICE);

      const response = await fetch(`${VERCEL_EMAIL_SERVICE}/api/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to, subject, html, text }),
      });

      const result = await response.json();

      if (result.success) {
        console.log("✅ Email sent via Vercel:", to);
        return { success: true, messageId: result.messageId };
      } else {
        console.error("❌ Vercel email service error:", result.message);
        throw new Error(result.message);
      }
    }

    // Fallback to local sending (development or if Vercel not configured)
    console.log("📧 Sending email locally (Vercel not configured)");

    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.log("⚠️ Email not configured. Email for:", to);
      console.log("📧 Subject:", subject);
      return {
        success: true,
        message: "Email logged (SMTP not configured)",
        logged: true
      };
    }

    const transporter = createTransporter();

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || "Medzen Innovations"}" <${process.env.SMTP_USER
        }>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]*>/g, ""), // Strip HTML for text version
    };

    const info = await transporter.sendMail(mailOptions);

    console.log("✅ Email sent successfully to:", to);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send OTP via email
 */
export const sendOTPEmail = async (email, otp) => {
  const html = `
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

  return sendEmail(
    email,
    "Your Verification Code - Medzen Innovations",
    html
  );
};

/**
 * Send approval notification email
 */
export const sendApprovalEmail = async (email, name, status) => {
  const isApproved = status === "approved";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { 
          background-color: ${isApproved ? "#4CAF50" : "#f44336"}; 
          color: white; 
          padding: 20px; 
          text-align: center; 
          border-radius: 5px 5px 0 0;
        }
        .content { background-color: white; padding: 30px; border: 1px solid #ddd; }
        .button {
          display: inline-block;
          padding: 12px 30px;
          background-color: #4CAF50;
          color: white;
          text-decoration: none;
          border-radius: 5px;
          margin-top: 20px;
        }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${isApproved ? "🎉 Account Approved!" : "Account Update"}</h1>
        </div>
        <div class="content">
          <h2>Hello ${name || "User"}!</h2>
          ${isApproved
      ? `
            <p>Great news! Your Medzen Innovations account has been approved by our admin team.</p>
            <p>You now have full access to the platform and can start using all features.</p>
            <a href="${getFrontendUrl()}/dashboard" class="button">Go to Dashboard</a>
          `
      : `
            <p>We regret to inform you that your account application was not approved at this time.</p>
            <p>If you have any questions, please contact our support team at ${process.env.SUPPORT_EMAIL || "support@medzeninnovations.com"
      }.</p>
          `
    }
          <p>Best regards,<br><strong>Medzen Innovations Team</strong></p>
        </div>
        <div class="footer">
          <p>&copy; 2025 Medzen Innovations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(
    email,
    isApproved
      ? "Welcome to Medzen Innovations - Account Approved!"
      : "Medzen Innovations - Account Update",
    html
  );
};

/**
 * Send welcome email with temporary password
 */
export const sendWelcomeEmail = async (email, name, role, tempPassword) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
        .header { background-color: #4A7EFC; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: white; padding: 30px; border-radius: 0 0 5px 5px; }
        .credentials-box { background-color: #f0f7ff; border: 2px solid #4A7EFC; padding: 20px; margin: 20px 0; border-radius: 5px; }
        .password { font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; color: #4A7EFC; background-color: #e8f2ff; padding: 10px; border-radius: 3px; display: inline-block; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
        .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 15px 0; }
        .button { display: inline-block; padding: 12px 30px; background-color: #4A7EFC; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Medzen Innovations</h1>
          <p>Welcome Aboard!</p>
        </div>
        <div class="content">
          <h2>Hello ${name}!</h2>
          <p>Your account has been successfully created by an administrator. Welcome to Medzen Innovations!</p>
          
          <div class="credentials-box">
            <h3 style="margin-top: 0;">Your Account Details:</h3>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Role:</strong> ${role.charAt(0).toUpperCase() + role.slice(1)
    }</p>
            <p><strong>Temporary Password:</strong></p>
            <div class="password">${tempPassword}</div>
          </div>
          
          <div class="warning">
            <strong>⚠️ Important Security Notice:</strong>
            <p>Please change your password immediately after your first login for security purposes.</p>
          </div>
          
          <p>To get started:</p>
          <ol>
            <li>Visit the Medzen Innovations login page</li>
            <li>Use your email and the temporary password above</li>
            <li>Change your password in your profile settings</li>
          </ol>
          
          <center>
            <a href="${getFrontendUrl()}" class="button">Login to Your Account</a>
          </center>
          
          <p>If you have any questions or need assistance, please contact our support team.</p>
          <p>Best regards,<br><strong>Medzen Innovations Team</strong></p>
        </div>
        <div class="footer">
          <p>&copy; 2025 Medzen Innovations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(
    email,
    "Welcome to Medzen Innovations - Account Created",
    html
  );
};

/**
 * Send password setup email
 */
export const sendPasswordSetupEmail = async (email, name, role, setupToken) => {
  const frontendUrl = getFrontendUrl();
  const setupLink = `${frontendUrl}/setup-password?token=${setupToken}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
        .header { background-color: #4A7EFC; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: white; padding: 30px; border-radius: 0 0 5px 5px; }
        .button { display: inline-block; padding: 15px 40px; background-color: #4A7EFC; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; text-align: center; }
        .button:hover { background-color: #3a6edc; }
        .info-box { background-color: #f0f7ff; border: 2px solid #4A7EFC; padding: 20px; margin: 20px 0; border-radius: 5px; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
        .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Welcome to Medzen Innovations!</h1>
        </div>
        <div class="content">
          <h2>Hello ${name}!</h2>
          <p>An administrator has created an account for you on Medzen Innovations. You're just one step away from getting started!</p>
          
          <div class="info-box">
            <h3 style="margin-top: 0;">Your Account Details:</h3>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Role:</strong> ${role.charAt(0).toUpperCase() + role.slice(1)
    }</p>
          </div>
          
          <h3>🔐 Set Up Your Password</h3>
          <p>Click the button below to create your password and access your account:</p>
          
          <div style="text-align: center;">
            <a href="${setupLink}" class="button">Set Up My Password</a>
          </div>
          
          <p style="margin-top: 20px; font-size: 14px; color: #666;">
            Or copy and paste this link into your browser:<br>
            <a href="${setupLink}" style="word-break: break-all; color: #4A7EFC;">${setupLink}</a>
          </p>
          
          <div class="warning">
            <strong>⏰ Important:</strong><br>
            This link will expire in <strong>24 hours</strong> for security reasons.
          </div>
          
          <h3>What's Next?</h3>
          <ol>
            <li>Click the button above to set your password</li>
            <li>Choose a strong, secure password</li>
            <li>Log in with your email and new password</li>
            <li>Start working on your assigned tickets!</li>
          </ol>
          
          <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
          
          <p>Best regards,<br>
          <strong>Medzen Innovations Team</strong></p>
        </div>
        <div class="footer">
          <p>This is an automated message, please do not reply to this email.</p>
          <p>&copy; 2025 Medzen Innovations. All rights reserved.</p>
          <p>If you didn't expect this email, please ignore it or contact our support team.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(
    email,
    "Welcome to Medzen Innovations - Set Up Your Password",
    html
  );
};

/**
 * Send ticket message notification email
 * @param {string} email - Recipient email
 * @param {string} recipientName - Recipient name
 * @param {object} ticketDetails - Ticket details (title, ticket_number, uid)
 * @param {string} senderName - Name of the person who sent the message
 */
export const sendTicketMessageEmail = async (email, recipientName, ticketDetails, senderName) => {
  const frontendUrl = getFrontendUrl();
  const ticketLink = `${frontendUrl}/tickets/${ticketDetails.uid}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; }
        .header { background-color: #4A7EFC; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background-color: white; padding: 30px; border-radius: 0 0 5px 5px; }
        .button { display: inline-block; padding: 15px 40px; background-color: #4A7EFC; color: white !important; text-decoration: none; border-radius: 5px; margin: 20px 0; font-weight: bold; text-align: center; }
        .button:hover { background-color: #3a6edc; }
        .ticket-info { background-color: #f0f7ff; border-left: 4px solid #4A7EFC; padding: 15px; margin: 20px 0; border-radius: 3px; }
        .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #777; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>💬 New Message in Ticket</h1>
        </div>
        <div class="content">
          <h2>Hello ${recipientName}!</h2>
          <p>You have received a new message in your ticket.</p>
          
          <div class="ticket-info">
            <p><strong>Ticket:</strong> ${ticketDetails.title}</p>
            <p><strong>Ticket Number:</strong> ${ticketDetails.ticket_number}</p>
            <p><strong>From:</strong> ${senderName}</p>
          </div>
          
          <p>Click the button below to view the message and respond:</p>
          
          <div style="text-align: center;">
            <a href="${ticketLink}" class="button">View Ticket</a>
          </div>
          
          <p style="margin-top: 20px; font-size: 14px; color: #666;">
            Or copy and paste this link into your browser:<br>
            <a href="${ticketLink}" style="word-break: break-all; color: #4A7EFC;">${ticketLink}</a>
          </p>
          
          <p>Best regards,<br>
          <strong>Medzen Innovations Team</strong></p>
        </div>
        <div class="footer">
          <p>This is an automated message, please do not reply to this email.</p>
          <p>&copy; 2025 Medzen Innovations. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return sendEmail(
    email,
    `You have a message in ${ticketDetails.title}`,
    html
  );
};

export default {
  sendEmail,
  sendOTPEmail,
  sendApprovalEmail,
  sendWelcomeEmail,
  sendPasswordSetupEmail,
  sendTicketMessageEmail,
};
