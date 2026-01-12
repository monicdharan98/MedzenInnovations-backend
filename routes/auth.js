import express from "express";
import {
  sendOTP,
  verifyOTPController,
  updateRole,
  updateName,
  updateDepartment,
  updatePhone,
  uploadProfilePicture,
  adminLogin,
  changeEmailSendOTP,
  changeEmailVerify,
  updateProfile,
  changePassword,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  checkLoginType,
  loginWithPassword,
  createPassword,
  setupPassword,
  acceptInvite,
  validateInviteToken,
  refreshToken,
  logout,
  checkTokenStatus,
} from "../controllers/authController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route   POST /api/auth/check-login-type
 * @desc    Check what type of login is required for an email
 * @access  Public
 */
router.post("/check-login-type", checkLoginType);

/**
 * @route   POST /api/auth/login-with-password
 * @desc    Login with email and password (for approved users)
 * @access  Public
 */
router.post("/login-with-password", loginWithPassword);

/**
 * @route   POST /api/auth/create-password
 * @desc    Create password for newly approved user
 * @access  Public
 */
router.post("/create-password", createPassword);

/**
 * @route   POST /api/auth/admin-login
 * @desc    Admin login with password
 * @access  Public
 */
router.post("/admin-login", adminLogin);

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to email or phone
 * @access  Public
 */
router.post("/send-otp", sendOTP);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and authenticate user
 * @access  Public
 */
router.post("/verify-otp", verifyOTPController);

/**
 * @route   POST /api/auth/setup-password
 * @desc    Set up password for new user created by admin (first-time login)
 * @access  Public
 */
router.post("/setup-password", setupPassword);

/**
 * @route   POST /api/auth/validate-invite-token
 * @desc    Validate an invite token without accepting it
 * @access  Public
 */
router.post("/validate-invite-token", validateInviteToken);

/**
 * @route   POST /api/auth/accept-invite
 * @desc    Accept a ticket invite. Supports logged-in users and new users (email+password)
 * @access  Public
 */
router.post("/accept-invite", acceptInvite);

/**
 * @route   PUT /api/auth/role
 * @desc    Update user role
 * @access  Private (requires authentication)
 */
router.put("/role", authenticateToken, updateRole);

/**
 * @route   PUT /api/auth/name
 * @desc    Update user name
 * @access  Private (requires authentication)
 */
router.put("/name", authenticateToken, updateName);

/**
 * @route   PUT /api/auth/department
 * @desc    Update user department (for employees)
 * @access  Private (requires authentication)
 */
router.put("/department", authenticateToken, updateDepartment);

/**
 * @route   PUT /api/auth/phone
 * @desc    Update user phone number (for clients only)
 * @access  Private (requires authentication)
 */
router.put("/phone", authenticateToken, updatePhone);

/**
 * @route   POST /api/auth/profile-picture
 * @desc    Upload profile picture
 * @access  Private (requires authentication)
 */
router.post("/profile-picture", authenticateToken, uploadProfilePicture);

/**
 * @route   POST /api/auth/update-profile
 * @desc    Update user profile (name and picture)
 * @access  Private (requires authentication)
 */
router.post("/update-profile", authenticateToken, updateProfile);

/**
 * @route   POST /api/auth/change-email-send-otp
 * @desc    Send OTP to new email for email change
 * @access  Private (requires authentication)
 */
router.post("/change-email-send-otp", authenticateToken, changeEmailSendOTP);

/**
 * @route   POST /api/auth/change-email-verify
 * @desc    Verify OTP and change email
 * @access  Private (requires authentication)
 */
router.post("/change-email-verify", authenticateToken, changeEmailVerify);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private (requires authentication)
 */
router.post("/change-password", authenticateToken, changePassword);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset OTP email
 * @access  Public (no authentication required)
 */
router.post("/forgot-password", forgotPassword);

/**
 * @route   POST /api/auth/verify-reset-otp
 * @desc    Verify OTP for password reset
 * @access  Public (no authentication required)
 */
router.post("/verify-reset-otp", verifyResetOTP);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password after OTP verification
 * @access  Public (no authentication required)
 */
router.post("/reset-password", resetPassword);

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Refresh access token using refresh token
 * @access  Public (no authentication required - uses refresh token)
 */
router.post("/refresh-token", refreshToken);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user and revoke refresh token
 * @access  Private (requires authentication)
 */
router.post("/logout", authenticateToken, logout);

/**
 * @route   GET /api/auth/token-status
 * @desc    Check current token status and expiration
 * @access  Private (requires authentication)
 */
router.get("/token-status", authenticateToken, checkTokenStatus);

export default router;
