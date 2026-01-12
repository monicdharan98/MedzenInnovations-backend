import { supabase, supabaseAdmin } from "../config/supabase.js";
import {
  successResponse,
  errorResponse,
  validationError,
} from "../utils/responses.js";
import {
  generateOTP,
  hashOTP,
  verifyOTP,
  getOTPExpiry,
  isOTPExpired,
} from "../utils/otp.js";
import { sendOTPEmail, sendEmail } from "../utils/emailService.js";
import { createUserRequestNotification } from "../utils/notificationHelper.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  generateTokenPair,
  verifyRefreshToken,
  checkTokenExpiration,
  validateStoredRefreshToken,
  revokeRefreshToken,
} from "../utils/tokenUtils.js";

/**
 * Check login type for email
 * POST /api/auth/check-login-type
 */
export const checkLoginType = async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return validationError(res, { field: "Email is required" });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return validationError(res, { email: "Invalid email format" });
    }

    // Check if user exists
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, email, approval_status, password, is_verified")
      .eq("email", email)
      .single();

    if (!user) {
      // New user - needs OTP registration
      return successResponse(res, {
        loginType: "otp",
        requiresRegistration: true,
        message: "New user - OTP will be sent for registration",
      });
    }

    // Check if user is approved
    if (user.approval_status === "approved") {
      // Check if user has set a password
      if (user.password) {
        return successResponse(res, {
          loginType: "password",
          requiresPasswordCreation: false,
          userId: user.id,
          message: "Please enter your password to login",
        });
      } else {
        return successResponse(res, {
          loginType: "create_password",
          requiresPasswordCreation: true,
          userId: user.id,
          message: "Please create a password for your account",
        });
      }
    } else if (user.approval_status === "pending") {
      return successResponse(res, {
        loginType: "pending",
        message: "Your account is pending admin approval",
      });
    } else if (user.approval_status === "rejected") {
      return successResponse(res, {
        loginType: "rejected",
        message: "Your account has been rejected. Please contact support.",
      });
    }

    // Default to OTP if status is unclear
    return successResponse(res, {
      loginType: "otp",
      requiresRegistration: false,
      userId: user.id,
    });
  } catch (error) {
    console.error("Check login type error:", error);
    return errorResponse(res, "Failed to check login type", 500);
  }
};

/**
 * Login with password
 * POST /api/auth/login-with-password
 */
export const loginWithPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return validationError(res, { field: "Email and password are required" });
    }

    // Get user from database
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (userError || !user) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    // Check if user is approved
    if (user.approval_status !== "approved") {
      return errorResponse(res, "Your account is not approved yet", 403);
    }

    // Check if user has a password set
    if (!user.password) {
      return errorResponse(res, "Please create a password first", 400);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return errorResponse(res, "Invalid email or password", 401);
    }

    // Check for "remember me" option
    const rememberMe = req.body.rememberMe || false;

    // Generate token pair (access + refresh tokens)
    const tokens = generateTokenPair(user, rememberMe);

    console.log("🔐 Login successful:", {
      userId: user.id,
      email: user.email,
      role: user.role,
      rememberMe,
      accessTokenExpiry: "15 minutes",
      refreshTokenExpiry: rememberMe ? "90 days" : "30 days",
    });

    return successResponse(
      res,
      {
        // For backward compatibility, include 'token' field
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        refreshExpiresIn: tokens.refreshExpiresIn,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          profile_picture: user.profile_picture,
          isVerified: user.is_verified,
          approvalStatus: user.approval_status,
        },
      },
      "Login successful",
      200
    );
  } catch (error) {
    console.error("Login with password error:", error);
    return errorResponse(res, "Login failed", 500);
  }
};

/**
 * Create password for approved user
 * POST /api/auth/create-password
 */
export const createPassword = async (req, res) => {
  try {
    const { userId, password } = req.body;

    // Validation
    if (!userId || !password) {
      return validationError(res, {
        field: "User ID and password are required",
      });
    }

    if (password.length < 6) {
      return validationError(res, {
        password: "Password must be at least 6 characters",
      });
    }

    // Get user
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if user is approved
    if (user.approval_status !== "approved") {
      return errorResponse(res, "Your account must be approved first", 403);
    }

    // Check if password already exists
    if (user.password) {
      return errorResponse(
        res,
        "Password already exists. Please use login instead.",
        400
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update user with password
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password: hashedPassword })
      .eq("id", userId);

    if (updateError) {
      console.error("Error creating password:", updateError);
      return errorResponse(res, "Failed to create password", 500);
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return successResponse(
      res,
      {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          profile_picture: user.profile_picture,
          isVerified: user.is_verified,
          approvalStatus: user.approval_status,
        },
      },
      "Password created successfully",
      200
    );
  } catch (error) {
    console.error("Create password error:", error);
    return errorResponse(res, "Failed to create password", 500);
  }
};

/**
 * Send OTP to email
 * POST /api/auth/send-otp
 */
export const sendOTP = async (req, res) => {
  try {
    const { email } = req.body;

    console.log("📧 Send OTP request:", { email });

    // Validation
    if (!email) {
      return validationError(res, { field: "Email is required" });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return validationError(res, { email: "Invalid email format" });
    }

    // Generate 4-digit OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = getOTPExpiry(10); // 10 minutes

    // Check if user exists (use admin client to bypass RLS)
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, email, name")
      .eq("email", email)
      .single();

    let userId;

    if (existingUser) {
      // User exists, use existing ID
      userId = existingUser.id;
    } else {
      // Create new user record with pending approval status
      const { data: newUser, error: createError } = await supabaseAdmin
        .from("users")
        .insert([
          {
            email: email,
            is_verified: false,
            approval_status: "pending",
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (createError) {
        console.error("Error creating user:", createError);
        return errorResponse(res, "Failed to create user record", 500);
      }

      userId = newUser.id;
    }

    // Store OTP in database
    const { error: otpError } = await supabaseAdmin
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
      return errorResponse(res, "Failed to send OTP", 500);
    }

    // Send OTP via email
    console.log("📧 Attempting to send OTP email to:", email);
    console.log("🔑 Generated OTP:", otp);

    const emailResult = await sendOTPEmail(email, otp);

    if (!emailResult.success) {
      console.error("❌ Email sending failed:", emailResult.error);
      console.log("⚠️ OTP stored in database but email failed");
      console.log("📋 OTP for manual delivery:", otp);
    } else {
      console.log("✅ OTP email sent successfully");
    }

    return successResponse(
      res,
      {
        userId,
        expiresAt,
        emailSent: emailResult.success,
        // Include OTP in response for development/testing (remove in production)
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
      emailResult.success
        ? "OTP sent to your email successfully"
        : "OTP generated but email delivery failed. Check server logs.",
      200
    );
  } catch (error) {
    console.error("Send OTP error:", error);
    return errorResponse(res, "Failed to send OTP", 500);
  }
};

/**
 * Verify OTP and authenticate user
 * POST /api/auth/verify-otp
 */
export const verifyOTPController = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    console.log("🔐 OTP Verification attempt:", {
      userId,
      otp: "****",
      otpLength: otp?.length,
      otpType: typeof otp,
    });

    // Validation
    if (!userId || !otp) {
      return validationError(res, { field: "User ID and OTP are required" });
    }

    // Get latest OTP record for user
    const { data: otpRecord, error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .select("*")
      .eq("user_id", userId)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    console.log("📊 OTP Record from DB:", {
      found: !!otpRecord,
      error: otpError,
      otpHash: otpRecord?.otp_hash?.substring(0, 20) + "...",
      expiresAt: otpRecord?.expires_at,
      createdAt: otpRecord?.created_at,
    });

    if (otpError || !otpRecord) {
      console.log("❌ No OTP record found");
      return errorResponse(res, "No OTP found for this user", 400);
    }

    // Check if OTP is expired
    if (isOTPExpired(otpRecord.expires_at)) {
      console.log("❌ OTP expired:", {
        expiresAt: otpRecord.expires_at,
        now: new Date().toISOString(),
      });
      return errorResponse(
        res,
        "OTP has expired. Please request a new one",
        400
      );
    }

    console.log("✅ OTP not expired");

    // Verify OTP
    const otpString = String(otp).trim();
    console.log("🔍 Verifying OTP:", {
      provided: otpString,
      storedHash: otpRecord.otp_hash.substring(0, 20) + "...",
    });
    const isValid = verifyOTP(otpString, otpRecord.otp_hash);

    console.log("🔐 OTP Verification result:", {
      isValid,
      providedOTP: otpString,
    });

    if (!isValid) {
      console.log("❌ Invalid OTP provided");
      return errorResponse(res, "Invalid OTP", 400);
    }

    console.log("✅ OTP is valid!");

    // Mark OTP as verified
    await supabaseAdmin
      .from("otp_verifications")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    // Update user as verified
    const { data: user, error: updateError } = await supabaseAdmin
      .from("users")
      .update({ is_verified: true })
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating user:", updateError);
      return errorResponse(res, "Failed to verify user", 500);
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return successResponse(
      res,
      {
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
      },
      "OTP verified successfully",
      200
    );
  } catch (error) {
    console.error("Verify OTP error:", error);
    return errorResponse(res, "Failed to verify OTP", 500);
  }
};

/**
 * Update user role
 * PUT /api/auth/role
 */
export const updateRole = async (req, res) => {
  try {
    const { userId, role } = req.body;

    // Validation
    if (!userId || !role) {
      return validationError(res, { field: "User ID and role are required" });
    }

    const validRoles = ["employee", "client", "freelancer", "admin"];
    if (!validRoles.includes(role.toLowerCase())) {
      return validationError(res, {
        role: "Invalid role. Must be employee, client, freelancer, or admin",
      });
    }

    // Get current user status before update
    const { data: currentUser } = await supabaseAdmin
      .from("users")
      .select("role, approval_status")
      .eq("id", userId)
      .single();

    // Update user role and set approval status based on role
    const updateData = { role: role.toLowerCase() };

    // Auto-approve clients, keep employees/freelancers pending (except admin)
    if (role.toLowerCase() === "admin") {
      // Admins are always approved
      updateData.approval_status = "approved";
    } else if (role.toLowerCase() === "client") {
      // ✅ Auto-approve clients
      updateData.approval_status = "approved";
      updateData.approved_at = new Date().toISOString();
    } else {
      // Employees and freelancers need admin approval
      updateData.approval_status = "pending";
    }

    const { data: user, error } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating role:", error);
      return errorResponse(res, "Failed to update role", 500);
    }

    // Create notification ONLY for employees/freelancers (not clients):
    // 1. User is not admin
    // 2. User is not client (clients are auto-approved)
    // 3. This is the FIRST TIME role is being set
    // 4. New status is pending
    const isFirstTimeRoleSet =
      !currentUser?.role &&
      role.toLowerCase() !== "admin" &&
      role.toLowerCase() !== "client" &&
      updateData.approval_status === "pending";

    if (isFirstTimeRoleSet) {
      // DISABLED: Admin notifications for user access requests
      // await createUserRequestNotification(userId);
      console.log(
        `📝 User ${role} request created (no notification sent): ${user.name || user.email}`
      );
    } else if (role.toLowerCase() === "client") {
      console.log(
        `✅ Client auto-approved - no notification: ${user.name || user.email}`
      );
    }

    return successResponse(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          profilePicture: user.profile_picture,
          approvalStatus: user.approval_status,
        },
      },
      "Role updated successfully",
      200
    );
  } catch (error) {
    console.error("Update role error:", error);
    return errorResponse(res, "Failed to update role", 500);
  }
};

/**
 * Update user name
 * PUT /api/auth/name
 */
export const updateName = async (req, res) => {
  try {
    const { userId, name } = req.body;

    // Validation
    if (!userId || !name) {
      return validationError(res, { field: "User ID and name are required" });
    }

    if (name.trim().length < 2) {
      return validationError(res, {
        name: "Name must be at least 2 characters long",
      });
    }

    // Update user name
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .update({ name: name.trim() })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating name:", error);
      return errorResponse(res, "Failed to update name", 500);
    }

    return successResponse(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          profilePicture: user.profile_picture,
        },
      },
      "Name updated successfully",
      200
    );
  } catch (error) {
    console.error("Update name error:", error);
    return errorResponse(res, "Failed to update name", 500);
  }
};

/**
 * Update user department (for clients only)
 * PUT /api/auth/department
 */
export const updateDepartment = async (req, res) => {
  try {
    const { userId, department } = req.body;

    // Validation
    if (!userId || !department) {
      return validationError(res, {
        field: "User ID and department are required",
      });
    }

    if (department.trim().length < 2) {
      return validationError(res, {
        department: "Department must be at least 2 characters long",
      });
    }

    // Get user to check role
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, role")
      .eq("id", userId)
      .single();

    if (fetchError || !existingUser) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if user is a client
    if (existingUser.role !== "client") {
      return errorResponse(
        res,
        "Department can only be set for client users",
        403
      );
    }

    // Update user department
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .update({ department: department.trim() })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating department:", error);
      return errorResponse(res, "Failed to update department", 500);
    }

    return successResponse(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          department: user.department,
          profilePicture: user.profile_picture,
        },
      },
      "Department updated successfully",
      200
    );
  } catch (error) {
    console.error("Update department error:", error);
    return errorResponse(res, "Failed to update department", 500);
  }
};

/**
 * Update user phone number (for clients only)
 * PUT /api/auth/phone
 */
export const updatePhone = async (req, res) => {
  try {
    const { userId, phone } = req.body;

    // Validation
    if (!userId || !phone) {
      return validationError(res, {
        field: "User ID and phone number are required",
      });
    }

    // Validate phone format (allow various formats)
    const cleanPhone = phone.replace(/[\s-()]/g, "");
    if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
      return validationError(res, {
        phone:
          "Invalid phone number format. Please enter a valid phone number.",
      });
    }

    // Get user to check role
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, role")
      .eq("id", userId)
      .single();

    if (fetchError || !existingUser) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if user is a client
    if (existingUser.role !== "client") {
      return errorResponse(
        res,
        "Phone number can only be set for client users",
        403
      );
    }

    // Update user phone
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .update({ phone: phone.trim() })
      .eq("id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating phone:", error);
      return errorResponse(res, "Failed to update phone number", 500);
    }

    return successResponse(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          department: user.department,
          profilePicture: user.profile_picture,
        },
      },
      "Phone number updated successfully",
      200
    );
  } catch (error) {
    console.error("Update phone error:", error);
    return errorResponse(res, "Failed to update phone number", 500);
  }
};

/**
 * Upload profile picture
 * POST /api/auth/profile-picture
 */
export const uploadProfilePicture = async (req, res) => {
  try {
    const { userId, imageBase64, fileName } = req.body;

    // Validation
    if (!userId || !imageBase64) {
      return validationError(res, { field: "User ID and image are required" });
    }

    // Extract base64 data
    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return validationError(res, { image: "Invalid image format" });
    }

    const contentType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Generate unique filename
    const fileExt = contentType.split("/")[1];
    const uniqueFileName = `${userId}_${Date.now()}.${fileExt}`;
    const filePath = `profile-pictures/${uniqueFileName}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("user-uploads")
      .upload(filePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Error uploading file:", uploadError);
      return errorResponse(res, "Failed to upload profile picture", 500);
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from("user-uploads")
      .getPublicUrl(filePath);

    const profilePictureUrl = urlData.publicUrl;

    // Update user profile picture URL
    const { data: user, error: updateError } = await supabaseAdmin
      .from("users")
      .update({ profile_picture: profilePictureUrl })
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating user:", updateError);
      return errorResponse(res, "Failed to update profile picture", 500);
    }

    return successResponse(
      res,
      {
        profilePicture: profilePictureUrl,
        user: {
          id: user.id,
          email: user.email,
          phone: user.phone,
          name: user.name,
          role: user.role,
          profilePicture: user.profile_picture,
        },
      },
      "Profile picture uploaded successfully",
      200
    );
  } catch (error) {
    console.error("Upload profile picture error:", error);
    return errorResponse(res, "Failed to upload profile picture", 500);
  }
};

/**
 * Admin login with password (for gokkull04@gmail.com)
 * POST /api/auth/admin-login
 */
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log("🔐 Admin login attempt:", { email, password: "***" });

    // Validation
    if (!email || !password) {
      return validationError(res, { field: "Email and password are required" });
    }

    // Get admin user from database
    const { data: adminUser, error: adminError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("role", "admin")
      .single();

    console.log("📊 Database query result:", {
      adminUser: adminUser ? "found" : "not found",
      adminError,
    });

    if (adminError || !adminUser) {
      console.log("❌ Admin not found in database", adminError);
      return errorResponse(res, "Invalid admin credentials", 401);
    }

    // Check if admin has a password set
    if (!adminUser.password) {
      console.log("❌ Admin password not set in database");
      return errorResponse(
        res,
        "Admin account not properly configured. Please contact support.",
        500
      );
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, adminUser.password);

    if (!isPasswordValid) {
      console.log("❌ Invalid password");
      return errorResponse(res, "Invalid password", 401);
    }

    console.log("✅ Password validated, generating JWT token");

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return successResponse(
      res,
      {
        token,
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
          profile_picture: adminUser.profile_picture,
          isVerified: adminUser.is_verified,
          approvalStatus: adminUser.approval_status,
        },
      },
      "Admin login successful",
      200
    );
  } catch (error) {
    console.error("Admin login error:", error);
    return errorResponse(res, "Admin login failed", 500);
  }
};

/**
 * Send OTP to verify new email for email change
 * POST /api/auth/change-email-send-otp
 */
export const changeEmailSendOTP = async (req, res) => {
  try {
    const { newEmail } = req.body;
    const userId = req.user?.userId;

    // Validation
    if (!newEmail) {
      return validationError(res, { email: "New email is required" });
    }

    if (!userId) {
      return errorResponse(res, "User not authenticated", 401);
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return validationError(res, { email: "Invalid email format" });
    }

    // Get current user
    const { data: currentUser } = await supabaseAdmin
      .from("users")
      .select("email, name")
      .eq("id", userId)
      .single();

    if (!currentUser) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if new email is same as current
    if (newEmail === currentUser.email) {
      return errorResponse(
        res,
        "New email must be different from current email",
        400
      );
    }

    // Check if new email is already in use by another user
    const { data: existingUsers } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", newEmail);

    if (existingUsers && existingUsers.length > 0) {
      return errorResponse(res, "Email is already in use", 400);
    }

    // Generate 4-digit OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = getOTPExpiry(10); // 10 minutes

    // Delete any existing unverified OTPs for this user
    await supabaseAdmin
      .from("otp_verifications")
      .delete()
      .eq("user_id", userId)
      .eq("verified", false);

    // Store OTP in database
    const { error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .insert([
        {
          user_id: userId,
          otp_hash: otpHash,
          expires_at: expiresAt,
          verified: false,
        },
      ]);

    if (otpError) {
      console.error("Error storing OTP:", otpError);
      return errorResponse(res, "Failed to generate OTP", 500);
    }

    // Send OTP to NEW email (to verify access to the new email)
    await sendOTPEmail(newEmail, otp);

    return successResponse(
      res,
      {
        message: "OTP sent to your new email address for verification",
      },
      "OTP sent successfully",
      200
    );
  } catch (error) {
    console.error("Change email send OTP error:", error);
    return errorResponse(res, "Failed to send OTP", 500);
  }
};

/**
 * Verify OTP and change email
 * POST /api/auth/change-email-verify
 */
export const changeEmailVerify = async (req, res) => {
  try {
    const { newEmail, otp } = req.body;
    const userId = req.user?.userId;

    // Validation
    if (!newEmail || !otp) {
      return validationError(res, {
        email: !newEmail ? "New email is required" : undefined,
        otp: !otp ? "OTP is required" : undefined,
      });
    }

    if (!userId) {
      return errorResponse(res, "User not authenticated", 401);
    }

    // Get the latest OTP for this user
    const { data: otpRecord, error: otpFetchError } = await supabaseAdmin
      .from("otp_verifications")
      .select("*")
      .eq("user_id", userId)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpFetchError || !otpRecord) {
      return errorResponse(
        res,
        "No valid OTP found. Please request a new OTP.",
        400
      );
    }

    // Check if OTP is expired
    if (isOTPExpired(otpRecord.expires_at)) {
      return errorResponse(
        res,
        "OTP has expired. Please request a new one.",
        400
      );
    }

    // Verify OTP
    const isValid = verifyOTP(otp, otpRecord.otp_hash);
    if (!isValid) {
      return errorResponse(res, "Invalid OTP", 400);
    }

    // Check if new email is still available (excluding current user)
    const { data: existingUsers } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", newEmail)
      .neq("id", userId);

    if (existingUsers && existingUsers.length > 0) {
      return errorResponse(res, "Email is already in use", 400);
    }

    // Get current user email for rollback if needed
    const { data: currentUser } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", userId)
      .single();

    // Update email in database
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update({ email: newEmail })
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating email:", updateError);
      return errorResponse(res, "Failed to update email", 500);
    }

    // Update email in Supabase Auth
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { email: newEmail }
    );

    if (authError) {
      console.error("Error updating auth email:", authError);
      // Rollback database change
      await supabaseAdmin
        .from("users")
        .update({ email: currentUser.email })
        .eq("id", userId);
      return errorResponse(res, "Failed to update authentication email", 500);
    }

    // Clean up all OTP verification records for this user after successful email change
    await supabaseAdmin
      .from("otp_verifications")
      .delete()
      .eq("user_id", userId);

    return successResponse(
      res,
      {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
        },
      },
      "Email changed successfully",
      200
    );
  } catch (error) {
    console.error("Change email verify error:", error);
    return errorResponse(res, "Failed to change email", 500);
  }
};

/**
 * Update user profile (name and profile picture)
 * POST /api/auth/update-profile
 */
export const updateProfile = async (req, res) => {
  try {
    const { userId, name, imageBase64, removeProfilePicture } = req.body;

    if (!userId) {
      return validationError(res, { userId: "User ID is required" });
    }

    const updateData = {};
    let profilePictureUrl = null;

    // Update name if provided
    if (name) {
      updateData.name = name;
    }

    // Handle profile picture removal
    if (removeProfilePicture) {
      updateData.profile_picture = null;
    }
    // Handle profile picture upload if provided
    else if (imageBase64) {
      // Extract base64 data
      const matches = imageBase64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return errorResponse(res, "Invalid image format", 400);
      }

      const mimeType = matches[1];
      const base64Data = matches[2];
      const fileExt = mimeType.split("/")[1];
      const fileName = `${userId}_${Date.now()}.${fileExt}`;
      const filePath = `profile-pictures/${fileName}`;

      // Upload to Supabase Storage (using 'user-uploads' bucket)
      const { error: uploadError } = await supabaseAdmin.storage
        .from("user-uploads")
        .upload(filePath, Buffer.from(base64Data, "base64"), {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        console.error("Error uploading image:", uploadError);
        return errorResponse(res, "Failed to upload profile picture", 500);
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage
        .from("user-uploads")
        .getPublicUrl(filePath);

      profilePictureUrl = urlData.publicUrl;
      updateData.profile_picture = profilePictureUrl;
    }

    // Update user in database
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating profile:", updateError);
      return errorResponse(res, "Failed to update profile", 500);
    }

    return successResponse(
      res,
      {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          profile_picture: updatedUser.profile_picture,
        },
      },
      "Profile updated successfully",
      200
    );
  } catch (error) {
    console.error("Update profile error:", error);
    return errorResponse(res, "Failed to update profile", 500);
  }
};

/**
 * Change Password
 * POST /api/auth/change-password
 */
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id; // Get userId from authenticated token (secure)

    console.log("🔐 Change password request:", {
      userId,
      userEmail: req.user.email,
      userRole: req.user.role,
      hasCurrentPassword: !!currentPassword,
      hasNewPassword: !!newPassword,
    });

    // Validation
    if (!currentPassword || !newPassword) {
      return validationError(res, {
        field: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return validationError(res, {
        password: "Password must be at least 6 characters",
      });
    }

    // Get user from database
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      console.error("❌ User not found:", userId);
      return errorResponse(res, "User not found", 404);
    }

    console.log("👤 User found:", {
      id: user.id,
      email: user.email,
      role: user.role,
      hasStoredPassword: !!user.password,
    });

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );

    if (!isCurrentPasswordValid) {
      console.error("❌ Current password is incorrect for user:", userId);
      return errorResponse(res, "Current password is incorrect", 401);
    }

    console.log("✅ Current password verified");

    // Hash the new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);
    console.log("🔒 New password hashed");

    // Update password in database
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password: hashedNewPassword })
      .eq("id", userId);

    if (updateError) {
      console.error("❌ Error updating password:", updateError);
      return errorResponse(res, "Failed to update password", 500);
    }

    console.log("✅ Password updated successfully for user:", userId);

    return successResponse(
      res,
      { message: "Password changed successfully" },
      "Password changed successfully",
      200
    );
  } catch (error) {
    console.error("Change password error:", error);
    return errorResponse(res, "Failed to change password", 500);
  }
};

/**
 * Forgot Password - Send Reset Email
 * POST /api/auth/forgot-password
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validation
    if (!email) {
      return validationError(res, { field: "Email is required" });
    }

    console.log("🔐 Forgot password request:", { email });

    // Get user from database by email (all roles allowed)
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, email, name, role")
      .eq("email", email)
      .single();

    if (userError || !user) {
      console.error("❌ User not found:", userId);
      return errorResponse(res, "User not found", 404);
    }

    console.log("✅ User found for password reset:", {
      id: user.id,
      email: user.email,
      role: user.role,
    });

    // Generate 4-digit OTP for password reset
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in database
    const { error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .insert({
        user_id: user.id,
        otp_hash: otpHash,
        expires_at: expiresAt.toISOString(),
        verified: false,
      });

    if (otpError) {
      console.error("Error storing OTP:", otpError);
      return errorResponse(res, "Failed to send reset email", 500);
    }

    // Send email with OTP
    try {
      await sendEmail(
        user.email,
        "Password Reset - Medzen Innovations",
        `
        <h2>Password Reset Request</h2>
        <p>Hi ${user.name || "Admin"},</p>
        <p>Your password reset code is: <strong>${otp}</strong></p>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
        `
      );
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      // Don't fail the request if email fails
    }

    return successResponse(
      res,
      {
        message: "Password reset code sent to your registered email",
        email: user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3"), // Masked email
      },
      "Reset email sent successfully",
      200
    );
  } catch (error) {
    console.error("Forgot password error:", error);
    return errorResponse(res, "Failed to process forgot password request", 500);
  }
};

/**
 * Verify OTP for Password Reset
 * POST /api/auth/verify-reset-otp
 */
export const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    console.log("🔐 Verify reset OTP request:", { email, hasOTP: !!otp });

    // Validation
    if (!email) {
      return validationError(res, { field: "Email is required" });
    }

    if (!otp) {
      return validationError(res, { field: "OTP is required" });
    }

    if (otp.length !== 4) {
      return validationError(res, { otp: "OTP must be 4 digits" });
    }

    // Get user by email
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (userError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    // Get the most recent unverified OTP for this user
    const { data: otpRecords, error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (otpError || !otpRecords || otpRecords.length === 0) {
      return errorResponse(res, "No OTP found. Please request a new one.", 404);
    }

    const otpRecord = otpRecords[0];

    // Check if OTP has expired
    if (new Date(otpRecord.expires_at) < new Date()) {
      return errorResponse(
        res,
        "OTP has expired. Please request a new one.",
        400
      );
    }

    // Verify OTP
    const isValid = await bcrypt.compare(otp, otpRecord.otp_hash);

    if (!isValid) {
      return errorResponse(res, "Invalid OTP", 400);
    }

    // Mark OTP as verified
    await supabaseAdmin
      .from("otp_verifications")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    return successResponse(
      res,
      { message: "OTP verified successfully" },
      "OTP verified",
      200
    );
  } catch (error) {
    console.error("Verify reset OTP error:", error);
    return errorResponse(res, "Failed to verify OTP", 500);
  }
};

/**
 * Reset Password After OTP Verification
 * POST /api/auth/reset-password
 */
export const resetPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    console.log("🔐 Reset password request:", {
      email,
      hasNewPassword: !!newPassword,
    });

    // Validation
    if (!email) {
      return validationError(res, { field: "Email is required" });
    }

    if (!newPassword) {
      return validationError(res, { field: "New password is required" });
    }

    if (newPassword.length < 6) {
      return validationError(res, {
        password: "Password must be at least 6 characters",
      });
    }

    // Get user by email
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (userError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if there's a verified OTP for this user (within last 15 minutes)
    const fifteenMinutesAgo = new Date(
      Date.now() - 15 * 60 * 1000
    ).toISOString();
    const { data: verifiedOTP, error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .select("*")
      .eq("user_id", user.id)
      .eq("verified", true)
      .gte("created_at", fifteenMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(1);

    if (otpError || !verifiedOTP || verifiedOTP.length === 0) {
      return errorResponse(
        res,
        "No verified OTP found. Please verify OTP first.",
        400
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password in database
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password: hashedPassword })
      .eq("id", user.id);

    if (updateError) {
      console.error("Error updating password:", updateError);
      return errorResponse(res, "Failed to reset password", 500);
    }

    // Delete all OTP records for this user
    await supabaseAdmin
      .from("otp_verifications")
      .delete()
      .eq("user_id", user.id);

    return successResponse(
      res,
      { message: "Password reset successfully" },
      "Password reset successfully",
      200
    );
  } catch (error) {
    console.error("Reset password error:", error);
    return errorResponse(res, "Failed to reset password", 500);
  }
};

/**
 * Setup password for new users created by admin
 * POST /api/auth/setup-password
 */
export const setupPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    // Validation
    if (!token || !password) {
      return validationError(res, { field: "Token and password are required" });
    }

    // Validate password strength
    if (password.length < 8) {
      return validationError(res, {
        field: "Password must be at least 8 characters long",
      });
    }

    // Find user with this token
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("password_setup_token", token)
      .single();

    if (userError || !user) {
      return errorResponse(res, "Invalid or expired setup link", 400);
    }

    // Check if token is expired
    const tokenExpiry = new Date(user.password_setup_token_expiry);
    const now = new Date();

    if (now > tokenExpiry) {
      return errorResponse(
        res,
        "Setup link has expired. Please contact admin to resend the link.",
        400
      );
    }

    // Check if user already has Auth account (password already set)
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(
      user.id
    );

    if (authUser && authUser.user) {
      return errorResponse(
        res,
        "Password already set for this account. Please use login instead.",
        400
      );
    }

    // Create user in Supabase Auth
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: password,
        email_confirm: true,
        user_metadata: {
          name: user.name,
          role: user.role,
        },
      });

    if (authError) {
      console.error("Error creating auth user:", authError);
      return errorResponse(
        res,
        "Failed to set up password. Please try again.",
        500
      );
    }

    // Update user record - mark as verified and clear setup token
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        id: authData.user.id, // Update with Auth user ID
        is_verified: true,
        password_setup_token: null,
        password_setup_token_expiry: null,
      })
      .eq("id", user.id);

    if (updateError) {
      console.error("Error updating user record:", updateError);
      // Rollback: delete auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return errorResponse(
        res,
        "Failed to complete setup. Please try again.",
        500
      );
    }

    console.log("✅ Password setup completed for:", user.email);

    return successResponse(
      res,
      {
        user: {
          id: authData.user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        message: "Password set successfully! You can now log in.",
      },
      "Password setup completed",
      200
    );
  } catch (error) {
    console.error("Setup password error:", error);
    return errorResponse(res, "Failed to setup password", 500);
  }
};

/**
 * Accept a ticket invite token. Two flows supported:
 * 1) Authenticated user: pass token in body and Authorization header - user will be added to the ticket
 * 2) New user: pass token, email and password to create account and be added to ticket (skips OTP)
 * POST /api/auth/accept-invite
 */
export const acceptInvite = async (req, res) => {
  try {
    const { token, email, password } = req.body;

    console.log("🎫 Accept invite request:", {
      hasToken: !!token,
      hasEmail: !!email,
      hasPassword: !!password,
      hasAuthHeader: !!req.headers["authorization"],
    });

    if (!token) {
      console.log("❌ Missing token");
      return validationError(res, "Invite token is required");
    }

    // Fetch invite
    console.log("🔍 Fetching invite with token...");
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("ticket_invites")
      .select("*")
      .eq("token", token)
      .single();

    if (inviteError) {
      console.error("❌ Error fetching invite:", inviteError);
      return errorResponse(res, "Invalid invite token", 400);
    }

    if (!invite) {
      console.log("❌ Invite not found");
      return errorResponse(res, "Invalid invite token", 400);
    }

    console.log("✅ Invite found:", {
      inviteId: invite.id,
      ticketId: invite.ticket_id,
      expiresAt: invite.expires_at,
      uses: invite.uses,
      maxUses: invite.max_uses,
      createdAt: invite.created_at,
    });

    // Check expiration
    const now = new Date();
    const expiresAt = new Date(invite.expires_at);
    const isExpired = invite.expires_at && now > expiresAt;

    console.log("⏰ Expiration check:", {
      now: now.toISOString(),
      expiresAt: invite.expires_at,
      expiresAtDate: expiresAt.toISOString(),
      isExpired,
      timeDifferenceMs: expiresAt - now,
      timeDifferenceHours: (expiresAt - now) / (1000 * 60 * 60),
    });

    if (isExpired) {
      console.log("❌ Invite has expired");
      return errorResponse(res, "Invite link has expired", 400);
    }

    // Check usage
    console.log("📊 Usage check:", {
      currentUses: invite.uses,
      maxUses: invite.max_uses,
      isFullyUsed: invite.uses >= invite.max_uses,
    });

    if (invite.uses >= invite.max_uses) {
      console.log("❌ Invite already fully used");
      return errorResponse(res, "Invite link already used", 400);
    }

    // If Authorization header present, treat as authenticated user flow
    const authHeader = req.headers["authorization"];
    if (authHeader) {
      // Use existing authenticateToken middleware logic manually to attach user
      const tokenStr = authHeader.split(" ")[1];
      const jwt = await import("jsonwebtoken");
      let decoded;
      try {
        decoded = jwt.verify(tokenStr, process.env.JWT_SECRET);
      } catch (e) {
        return errorResponse(res, "Invalid or expired token", 401);
      }

      const { data: user, error: userErr } = await supabase
        .from("users")
        .select("*")
        .eq("id", decoded.userId)
        .single();

      if (userErr || !user)
        return errorResponse(res, "Invalid or expired token", 401);

      // Add to ticket_members
      const members = [
        {
          ticket_id: invite.ticket_id,
          user_id: user.id,
          added_by: user.id,
          can_message_client: true,
        },
      ];
      const { data: added, error: addErr } = await supabaseAdmin
        .from("ticket_members")
        .upsert(members, { onConflict: "ticket_id,user_id" })
        .select("*");

      if (addErr) {
        console.error("Error adding invited member:", addErr);
        return errorResponse(res, "Failed to add user to ticket", 500);
      }

      // Increment uses
      await supabaseAdmin
        .from("ticket_invites")
        .update({ uses: invite.uses + 1 })
        .eq("id", invite.id);

      return successResponse(
        res,
        { addedToTicket: true, ticketId: invite.ticket_id },
        "Invite accepted",
        200
      );
    }

    // Unauthenticated flow - require email + password to create account and skip OTP
    if (!email || !password) {
      return validationError(res, "Email and password required for new users");
    }

    // Check if email already has an auth account
    // Create auth user
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: email.toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { role: invite.role || "client" },
      });

    if (authError) {
      console.error("Error creating auth user from invite:", authError);
      return errorResponse(
        res,
        "Failed to create account with provided email",
        500
      );
    }

    // Upsert user record in users table (if pre-existing record exists, update id to auth id)
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("email", email.toLowerCase())
      .single();

    if (existingUser) {
      // Update existing DB record with auth id and mark verified
      const { error: updErr } = await supabaseAdmin
        .from("users")
        .update({
          id: authData.user.id,
          is_verified: true,
          password_setup_token: null,
          password_setup_token_expiry: null,
        })
        .eq("email", email.toLowerCase());

      if (updErr) {
        console.error(
          "Error updating existing user record after invite auth creation:",
          updErr
        );
        // rollback auth user
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return errorResponse(res, "Failed to create account", 500);
      }
    } else {
      // Insert new user record - extract name from email local part as fallback
      const emailLocalPart = email.split("@")[0];
      const fallbackName =
        emailLocalPart.charAt(0).toUpperCase() +
        emailLocalPart.slice(1).replace(/[._-]/g, " ");

      const { error: insertErr } = await supabaseAdmin.from("users").insert([
        {
          id: authData.user.id,
          email: email.toLowerCase(),
          name: fallbackName,
          role: invite.role || "client",
          is_verified: true,
          approval_status: "approved",
          created_at: new Date().toISOString(),
        },
      ]);

      if (insertErr) {
        console.error(
          "Error inserting user record after invite auth creation:",
          insertErr
        );
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return errorResponse(res, "Failed to create user record", 500);
      }
    }

    // Add to ticket_members
    const members2 = [
      {
        ticket_id: invite.ticket_id,
        user_id: authData.user.id,
        added_by: invite.created_by || null,
        can_message_client: true,
      },
    ];
    const { data: added2, error: addErr2 } = await supabaseAdmin
      .from("ticket_members")
      .upsert(members2, { onConflict: "ticket_id,user_id" })
      .select("*");

    if (addErr2) {
      console.error("Error adding invited member (new user):", addErr2);
      // rollback created user and DB entry
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      await supabaseAdmin.from("users").delete().eq("id", authData.user.id);
      return errorResponse(res, "Failed to add user to ticket", 500);
    }

    // Increment uses
    await supabaseAdmin
      .from("ticket_invites")
      .update({ uses: invite.uses + 1 })
      .eq("id", invite.id);

    return successResponse(
      res,
      { addedToTicket: true, ticketId: invite.ticket_id },
      "Account created and added to ticket",
      201
    );
  } catch (error) {
    console.error("acceptInvite error:", error);
    return errorResponse(res, "Failed to accept invite", 500);
  }
};

/**
 * Validate invite token - check if token is valid without accepting it
 * POST /api/auth/validate-invite-token
 */
export const validateInviteToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return validationError(res, "Invite token is required");
    }

    // Fetch invite
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("ticket_invites")
      .select("*, tickets(id, title, description, status)")
      .eq("token", token)
      .single();

    if (inviteError || !invite) {
      return errorResponse(res, "Invalid invite token", 400);
    }

    // Check if expired
    if (invite.expires_at && new Date() > new Date(invite.expires_at)) {
      return successResponse(res, {
        valid: false,
        reason: "expired",
        message: "Invite link has expired",
      });
    }

    // Check if already used up
    if (invite.uses >= invite.max_uses) {
      return successResponse(res, {
        valid: false,
        reason: "used",
        message: "Invite link has already been used",
      });
    }

    // Token is valid
    return successResponse(res, {
      valid: true,
      invite: {
        ticketId: invite.ticket_id,
        ticketTitle: invite.tickets?.title,
        ticketDescription: invite.tickets?.description,
        role: invite.role,
        expiresAt: invite.expires_at,
        maxUses: invite.max_uses,
        currentUses: invite.uses,
      },
    });
  } catch (error) {
    console.error("validateInviteToken error:", error);
    return errorResponse(res, "Failed to validate invite token", 500);
  }
};

/**
 * Refresh access token using refresh token
 * POST /api/auth/refresh-token
 */
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: clientRefreshToken } = req.body;

    console.log("🔄 Token refresh request received");

    // Validation
    if (!clientRefreshToken) {
      return validationError(res, { field: "Refresh token is required" });
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(clientRefreshToken);
    if (!decoded) {
      console.log("❌ Invalid refresh token");
      return errorResponse(res, "Invalid refresh token", 401);
    }

    console.log("✅ Refresh token verified for user:", decoded.userId);

    // Get current user data
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select(
        "id, email, name, role, profile_picture, is_verified, approval_status"
      )
      .eq("id", decoded.userId)
      .single();

    if (userError || !user) {
      console.log("❌ User not found for refresh token");
      return errorResponse(res, "User not found", 404);
    }

    // Check if user is still approved
    if (user.approval_status !== "approved") {
      console.log("❌ User no longer approved");
      return errorResponse(res, "User account is no longer approved", 403);
    }

    // Validate stored refresh token (optional - for enhanced security)
    const isValidStored = await validateStoredRefreshToken(
      user.id,
      clientRefreshToken
    );
    if (!isValidStored) {
      console.log("⚠️ Refresh token not found in storage (continuing anyway)");
      // Continue anyway since we're using stateless tokens for now
    }

    // Generate new token pair
    const tokens = generateTokenPair(user, false); // Don't extend on refresh

    console.log("🔐 New tokens generated for user:", {
      userId: user.id,
      email: user.email,
      role: user.role,
      accessTokenExpiry: "15 minutes",
    });

    return successResponse(
      res,
      {
        // For backward compatibility
        token: tokens.accessToken,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
        refreshExpiresIn: tokens.refreshExpiresIn,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          profile_picture: user.profile_picture,
          isVerified: user.is_verified,
          approvalStatus: user.approval_status,
        },
      },
      "Token refreshed successfully",
      200
    );
  } catch (error) {
    console.error("Refresh token error:", error);
    return errorResponse(res, "Failed to refresh token", 500);
  }
};

/**
 * Logout user and revoke refresh token
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  try {
    const { refreshToken: clientRefreshToken } = req.body;
    const userId = req.user?.id || req.user?.userId;

    console.log("🚪 Logout request:", {
      userId,
      hasRefreshToken: !!clientRefreshToken,
    });

    // If refresh token provided, try to revoke it
    if (clientRefreshToken && userId) {
      await revokeRefreshToken(userId, clientRefreshToken);
    }

    return successResponse(
      res,
      { loggedOut: true },
      "Logged out successfully",
      200
    );
  } catch (error) {
    console.error("Logout error:", error);
    return errorResponse(res, "Failed to logout", 500);
  }
};

/**
 * Check token status and expiration
 * GET /api/auth/token-status
 */
export const checkTokenStatus = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return errorResponse(res, "No token provided", 401);
    }

    const token = authHeader.substring(7);
    const tokenStatus = checkTokenExpiration(token);

    return successResponse(
      res,
      {
        ...tokenStatus,
        needsRefresh: tokenStatus.willExpireSoon,
        isValid: !tokenStatus.isExpired,
      },
      "Token status checked",
      200
    );
  } catch (error) {
    console.error("Check token status error:", error);
    return errorResponse(res, "Failed to check token status", 500);
  }
};
