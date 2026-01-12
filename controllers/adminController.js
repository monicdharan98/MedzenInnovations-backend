import { supabaseAdmin } from "../config/supabase.js";
import {
  successResponse,
  errorResponse,
  validationError,
} from "../utils/responses.js";
import { sendApprovalEmail } from "../utils/emailService.js";
import {
  createUserApprovedNotification,
  createUserRejectedNotification,
} from "../utils/notificationHelper.js";
import {
  generateOTP,
  hashOTP,
  verifyOTP as verifyOTPHash,
  getOTPExpiry,
} from "../utils/otp.js";

/**
 * Get all pending users for admin approval
 * GET /api/admin/pending-users
 */
export const getPendingUsers = async (req, res) => {
  try {
    const adminId = req.user?.id || req.user?.userId;

    // Fetch all users with pending approval status
    const { data: pendingUsers, error } = await supabaseAdmin
      .from("users")
      .select(
        "id, email, name, role, phone, department, profile_picture, created_at, is_verified"
      )
      .eq("approval_status", "pending")
      .eq("is_verified", true) // Only show users who have verified their email
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching pending users:", error);
      return errorResponse(res, "Failed to fetch pending users", 500);
    }

    // Get starred users for current admin
    const { data: starredUsers } = await supabaseAdmin
      .from("starred_users")
      .select("starred_user_id")
      .eq("user_id", adminId);

    const starredUserIds = new Set(
      (starredUsers || []).map((s) => s.starred_user_id)
    );

    return successResponse(
      res,
      {
        users: pendingUsers.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          department: user.department,
          profilePicture: user.profile_picture,
          createdAt: user.created_at,
          isVerified: user.is_verified,
          isStarred: starredUserIds.has(user.id),
        })),
        count: pendingUsers.length,
      },
      "Pending users fetched successfully",
      200
    );
  } catch (error) {
    console.error("Get pending users error:", error);
    return errorResponse(res, "Failed to fetch pending users", 500);
  }
};

/**
 * Get all approved users
 * GET /api/admin/approved-users
 */
export const getApprovedUsers = async (req, res) => {
  try {
    const adminId = req.user?.id || req.user?.userId;

    const { data: approvedUsers, error } = await supabaseAdmin
      .from("users")
      .select(
        "id, email, name, role, phone, department, profile_picture, created_at, approved_at"
      )
      .eq("approval_status", "approved")
      .order("approved_at", { ascending: false });

    if (error) {
      console.error("Error fetching approved users:", error);
      return errorResponse(res, "Failed to fetch approved users", 500);
    }

    // Get starred users for current admin
    const { data: starredUsers } = await supabaseAdmin
      .from("starred_users")
      .select("starred_user_id")
      .eq("user_id", adminId);

    const starredUserIds = new Set(
      (starredUsers || []).map((s) => s.starred_user_id)
    );

    return successResponse(
      res,
      {
        users: approvedUsers.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          department: user.department,
          profilePicture: user.profile_picture,
          createdAt: user.created_at,
          approvedAt: user.approved_at,
          isStarred: starredUserIds.has(user.id),
        })),
        count: approvedUsers.length,
      },
      "Approved users fetched successfully",
      200
    );
  } catch (error) {
    console.error("Get approved users error:", error);
    return errorResponse(res, "Failed to fetch approved users", 500);
  }
};

/**
 * Approve a user
 * POST /api/admin/approve-user
 */
export const approveUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const adminId = req.user?.id || req.user?.userId; // From auth middleware

    if (!adminId) {
      return errorResponse(res, "Admin not authenticated", 401);
    }

    // Validation
    if (!userId) {
      return validationError(res, { field: "User ID is required" });
    }

    // Verify the user exists and is pending
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email, name, approval_status")
      .eq("id", userId)
      .single();

    if (fetchError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    if (user.approval_status === "approved") {
      return errorResponse(res, "User is already approved", 400);
    }

    // Update user approval status
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        approval_status: "approved",
        approved_by: adminId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error approving user:", updateError);
      return errorResponse(res, "Failed to approve user", 500);
    }

    // Log admin action
    await supabaseAdmin.from("admin_actions").insert([
      {
        admin_id: adminId,
        action_type: "approve_user",
        target_user_id: userId,
        details: {
          user_email: user.email,
          user_name: user.name,
        },
      },
    ]);

    // Send approval email notification
    await sendApprovalEmail(user.email, user.name, "approved");

    // Create notification for the user
    await createUserApprovedNotification(userId);

    return successResponse(
      res,
      {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          role: updatedUser.role,
          approvalStatus: updatedUser.approval_status,
          approvedAt: updatedUser.approved_at,
        },
      },
      "User approved successfully",
      200
    );
  } catch (error) {
    console.error("Approve user error:", error);
    return errorResponse(res, "Failed to approve user", 500);
  }
};

/**
 * Reject a user
 * POST /api/admin/reject-user
 */
export const rejectUser = async (req, res) => {
  try {
    const { userId, reason } = req.body;
    const adminId = req.user?.id || req.user?.userId; // From auth middleware

    if (!adminId) {
      return errorResponse(res, "Admin not authenticated", 401);
    }

    // Validation
    if (!userId) {
      return validationError(res, { field: "User ID is required" });
    }

    // Verify the user exists
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email, name, approval_status")
      .eq("id", userId)
      .single();

    if (fetchError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    if (user.approval_status === "rejected") {
      return errorResponse(res, "User is already rejected", 400);
    }

    // Update user approval status
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update({
        approval_status: "rejected",
        approved_by: adminId,
        approved_at: new Date().toISOString(),
        rejection_reason: reason || "No reason provided",
      })
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("Error rejecting user:", updateError);
      return errorResponse(res, "Failed to reject user", 500);
    }

    // Log admin action
    await supabaseAdmin.from("admin_actions").insert([
      {
        admin_id: adminId,
        action_type: "reject_user",
        target_user_id: userId,
        details: {
          user_email: user.email,
          user_name: user.name,
          reason: reason || "No reason provided",
        },
      },
    ]);

    // Send rejection email notification
    await sendApprovalEmail(user.email, user.name, "rejected");

    // Create notification for the user
    await createUserRejectedNotification(userId);

    return successResponse(
      res,
      {
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          name: updatedUser.name,
          approvalStatus: updatedUser.approval_status,
          rejectionReason: updatedUser.rejection_reason,
        },
      },
      "User rejected successfully",
      200
    );
  } catch (error) {
    console.error("Reject user error:", error);
    return errorResponse(res, "Failed to reject user", 500);
  }
};

/**
 * Get admin dashboard statistics
 * GET /api/admin/stats
 */
export const getAdminStats = async (req, res) => {
  try {
    // Get counts for different statuses
    const { data: pendingCount } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "pending")
      .eq("is_verified", true);

    const { data: approvedCount } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "approved");

    const { data: rejectedCount } = await supabaseAdmin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("approval_status", "rejected");

    // Get recent admin actions
    const { data: recentActions } = await supabaseAdmin
      .from("admin_actions")
      .select(
        "*, admin:admin_id(name, email), target:target_user_id(name, email)"
      )
      .order("created_at", { ascending: false })
      .limit(10);

    return successResponse(
      res,
      {
        stats: {
          pending: pendingCount || 0,
          approved: approvedCount || 0,
          rejected: rejectedCount || 0,
          total:
            (pendingCount || 0) + (approvedCount || 0) + (rejectedCount || 0),
        },
        recentActions: recentActions || [],
      },
      "Admin stats fetched successfully",
      200
    );
  } catch (error) {
    console.error("Get admin stats error:", error);
    return errorResponse(res, "Failed to fetch admin stats", 500);
  }
};

/**
 * Get all users (for admin to add members to tickets)
 * GET /api/admin/users
 */
export const getAllUsers = async (req, res) => {
  try {
    const adminId = req.user?.id || req.user?.userId;

    console.log("📋 Fetching all users for admin:", adminId);

    const { data: users, error } = await supabaseAdmin
      .from("users")
      .select(
        "id, email, name, role, phone, department, profile_picture, approval_status, created_at"
      )
      .eq("approval_status", "approved")
      .eq("is_verified", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Error fetching users:", error);
      console.error("Error details:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return errorResponse(res, `Failed to fetch users: ${error.message}`, 500);
    }

    console.log(`✅ Fetched ${users?.length || 0} users`);

    // Get starred users for current admin
    const { data: starredUsers } = await supabaseAdmin
      .from("starred_users")
      .select("starred_user_id")
      .eq("user_id", adminId);

    const starredUserIds = new Set(
      (starredUsers || []).map((s) => s.starred_user_id)
    );

    return successResponse(
      res,
      {
        users: users.map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          phone: user.phone,
          department: user.department,
          profilePicture: user.profile_picture,
          profile_picture: user.profile_picture,
          created_at: user.created_at,
          isStarred: starredUserIds.has(user.id),
        })),
        count: users.length,
      },
      "Users fetched successfully",
      200
    );
  } catch (error) {
    console.error("Get all users error:", error);
    return errorResponse(res, "Failed to fetch users", 500);
  }
};

/**
 * Get tickets for a specific user
 * GET /api/admin/users/:userId/tickets
 */
export const getUserTickets = async (req, res) => {
  try {
    const { userId } = req.params;

    // Get all tickets where user is creator or member
    const { data: createdTickets } = await supabaseAdmin
      .from("tickets")
      .select("*")
      .eq("created_by", userId);

    const { data: memberTickets } = await supabaseAdmin
      .from("ticket_members")
      .select("ticket_id")
      .eq("user_id", userId);

    const memberTicketIds = (memberTickets || []).map((m) => m.ticket_id);

    let allTicketIds = [
      ...(createdTickets || []).map((t) => t.id),
      ...memberTicketIds,
    ];

    // Remove duplicates
    allTicketIds = [...new Set(allTicketIds)];

    if (allTicketIds.length === 0) {
      return successResponse(res, { tickets: [] }, "No tickets found for user");
    }

    // Fetch full ticket details
    const { data: tickets, error } = await supabaseAdmin
      .from("tickets")
      .select("*")
      .in("id", allTicketIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching user tickets:", error);
      return errorResponse(res, "Failed to fetch user tickets", 500);
    }

    // Get members for each ticket
    const ticketsWithMembers = await Promise.all(
      (tickets || []).map(async (ticket) => {
        const { data: ticketMembers } = await supabaseAdmin
          .from("ticket_members")
          .select("user_id")
          .eq("ticket_id", ticket.id);

        const memberIds = (ticketMembers || []).map((m) => m.user_id);

        if (memberIds.length === 0) {
          return {
            ...ticket,
            members: [],
          };
        }

        const { data: members } = await supabaseAdmin
          .from("users")
          .select("id, name, profile_picture")
          .in("id", memberIds);

        return {
          ...ticket,
          members: members || [],
        };
      })
    );

    return successResponse(
      res,
      { tickets: ticketsWithMembers },
      "User tickets fetched successfully"
    );
  } catch (error) {
    console.error("Get user tickets error:", error);
    return errorResponse(res, "Failed to fetch user tickets", 500);
  }
};

/**
 * Update user email
 * PUT /api/admin/users/:userId/email
 */
export const updateUserEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { email } = req.body;

    // Validate email
    if (!email || !email.includes("@")) {
      return errorResponse(res, "Invalid email address", 400);
    }

    // Get the current user data
    const { data: currentUser, error: getUserError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (getUserError || !currentUser) {
      console.error("Error fetching current user:", getUserError);
      return errorResponse(res, "User not found", 404);
    }

    // Check if new email already exists (and it's not the current user)
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("email", email)
      .neq("id", userId)
      .single();

    if (existingUser) {
      return errorResponse(res, "Email already in use", 400);
    }

    // Update user email while keeping verification and approval status
    // Since admin is changing it, user doesn't need to verify or wait for approval again
    const { data: updatedUser, error } = await supabaseAdmin
      .from("users")
      .update({
        email: email,
        is_verified: true, // Keep user verified since admin is making the change
        approval_status: currentUser.approval_status, // Keep current approval status
      })
      .eq("id", userId)
      .select("id, email, name, role, is_verified, approval_status")
      .single();

    if (error) {
      console.error("Error updating user email:", error);
      return errorResponse(res, "Failed to update email", 500);
    }

    // Update user's auth email in Supabase Auth (if using Supabase Auth)
    // This ensures the user can login with the new email
    try {
      const { error: authError } =
        await supabaseAdmin.auth.admin.updateUserById(userId, { email: email });

      if (authError) {
        console.error("Error updating auth email:", authError);
        // Continue anyway as the database is updated
      }
    } catch (authError) {
      console.error("Error updating Supabase Auth email:", authError);
      // Continue anyway as the database is updated
    }

    console.log(
      `✅ Admin updated user ${userId} email from ${currentUser.email} to ${email}`
    );

    return successResponse(
      res,
      {
        user: updatedUser,
        message:
          "Email updated successfully. User can now login with the new email.",
      },
      "Email updated successfully",
      200
    );
  } catch (error) {
    console.error("Update user email error:", error);
    return errorResponse(res, "Failed to update email", 500);
  }
};

/**
 * Send OTP to new user's email
 * POST /api/admin/send-user-otp
 */
export const sendUserOTP = async (req, res) => {
  try {
    const { email, name, userType } = req.body;

    // Validate input
    if (!email || !name || !userType) {
      return validationError(res, "Email, name, and user type are required");
    }

    // Check if email already exists
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (existingUser) {
      return errorResponse(res, "User with this email already exists", 400);
    }

    // Generate and hash OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = getOTPExpiry(10); // 10 minutes

    // Create a temporary user record to store the OTP
    // We'll use a placeholder UUID that we can track
    const { data: tempUser, error: tempUserError } = await supabaseAdmin
      .from("users")
      .insert([
        {
          email: email,
          name: name,
          role: userType,
          is_verified: false,
          approval_status: "pending", // Use pending (will be changed to approved after OTP)
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (tempUserError) {
      console.error("Error creating temp user:", tempUserError);
      return errorResponse(res, "Failed to initiate user creation", 500);
    }

    // Store OTP with the temp user's UUID
    const { error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .insert([
        {
          user_id: tempUser.id,
          otp_hash: otpHash,
          expires_at: expiresAt,
          verified: false,
          created_at: new Date().toISOString(),
        },
      ]);

    if (otpError) {
      console.error("Error storing OTP:", otpError);
      // Clean up temp user if OTP storage fails
      await supabaseAdmin.from("users").delete().eq("id", tempUser.id);
      return errorResponse(res, "Failed to send OTP", 500);
    }

    // Send OTP email
    console.log("📧 Attempting to send OTP email to:", email);
    console.log("🔑 Generated OTP:", otp);

    const emailService = await import("../utils/emailService.js");
    const emailResult = await emailService.sendOTPEmail(email, otp);

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
        email,
        tempUserId: tempUser.id,
        message: "OTP sent successfully",
        emailSent: emailResult.success,
        // Include OTP in response for development/testing (remove in production)
        ...(process.env.NODE_ENV === "development" && { otp }),
      },
      emailResult.success
        ? "OTP sent to email"
        : "OTP generated but email delivery failed. Check server logs.",
      200
    );
  } catch (error) {
    console.error("Send user OTP error:", error);
    return errorResponse(res, "Failed to send OTP", 500);
  }
};

/**
 * Add new user with OTP verification
 * POST /api/admin/add-user
 */
export const addUser = async (req, res) => {
  try {
    const { name, email, role, otp, tempUserId } = req.body;

    // Validate input
    if (!name || !email || !role || !otp || !tempUserId) {
      return validationError(
        res,
        "Name, email, role, OTP, and tempUserId are required"
      );
    }

    // Get latest OTP record
    const { data: otpRecord, error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .select("*")
      .eq("user_id", tempUserId)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      return errorResponse(res, "No OTP found or OTP already used", 400);
    }

    // Check if OTP is expired
    const { isOTPExpired } = await import("../utils/otp.js");
    if (isOTPExpired(otpRecord.expires_at)) {
      // Clean up temp user
      await supabaseAdmin.from("users").delete().eq("id", tempUserId);
      return errorResponse(res, "OTP has expired", 400);
    }

    // Verify OTP
    const otpString = String(otp).trim();
    const isValid = verifyOTPHash(otpString, otpRecord.otp_hash);

    if (!isValid) {
      return errorResponse(res, "Invalid OTP", 400);
    }

    // Mark OTP as verified
    await supabaseAdmin
      .from("otp_verifications")
      .update({ verified: true })
      .eq("id", otpRecord.id);

    // Get the temp user record
    const { data: tempUser } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", tempUserId)
      .single();

    if (!tempUser) {
      return errorResponse(res, "Temporary user record not found", 400);
    }

    // Create user in Supabase Auth with a temporary password
    const tempPassword = `Temp${Math.random().toString(36).substring(2, 15)}!`;
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        user_metadata: {
          name,
          role,
        },
      });

    if (authError) {
      console.error("Error creating auth user:", authError);
      // Clean up temp user
      await supabaseAdmin.from("users").delete().eq("id", tempUserId);
      return errorResponse(res, "Failed to create user account", 500);
    }

    // Delete the temp user record
    await supabaseAdmin.from("users").delete().eq("id", tempUserId);

    // Create new record with auth user ID
    const { data: finalUser, error: finalError } = await supabaseAdmin
      .from("users")
      .insert([
        {
          id: authData.user.id,
          email: email,
          name: name,
          role: role,
          is_verified: true,
          approval_status: "approved",
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (finalError) {
      console.error("Error creating final user record:", finalError);
      // Clean up auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return errorResponse(res, "Failed to create final user record", 500);
    }

    // Send welcome email with temporary password
    const emailService = await import("../utils/emailService.js");
    await emailService.sendWelcomeEmail(email, name, role, tempPassword);

    return successResponse(
      res,
      {
        user: {
          id: finalUser.id,
          email: finalUser.email,
          name: finalUser.name,
          role: finalUser.role,
        },
        message: "User created successfully",
      },
      "User added successfully",
      201
    );
  } catch (error) {
    console.error("Add user error:", error);
    return errorResponse(res, "Failed to add user", 500);
  }
};

/**
 * Delete a user (employees, freelancers, clients)
 * DELETE /api/admin/users/:userId
 */
export const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id || req.user?.userId;

    if (!userId) {
      return validationError(res, { userId: "User ID is required" });
    }

    // Get user details before deletion
    const { data: user, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (fetchError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    // Prevent deletion of admin users
    if (user.role === "admin") {
      return errorResponse(res, "Cannot delete admin users", 403);
    }

    // Only allow deletion of employees, freelancers, and clients
    const deletableRoles = ["employee", "freelancer", "client", "staff"];
    if (!deletableRoles.includes(user.role.toLowerCase())) {
      return errorResponse(
        res,
        `Cannot delete users with role: ${user.role}`,
        403
      );
    }

    console.log(`🗑️ Admin ${adminId} deleting user:`, {
      userId,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
    });

    // Get count of tickets where user is assigned
    const { count: assignedTicketsCount } = await supabaseAdmin
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("assigned_to", userId);

    // Remove user from all ticket assignments
    const { error: ticketUpdateError } = await supabaseAdmin
      .from("tickets")
      .update({
        assigned_to: null,
        updated_at: new Date().toISOString(),
      })
      .eq("assigned_to", userId);

    if (ticketUpdateError) {
      console.error("Error removing user from tickets:", ticketUpdateError);
      // Continue with deletion even if ticket update fails
    } else if (assignedTicketsCount > 0) {
      console.log(
        `✅ Removed user from ${assignedTicketsCount} ticket assignment(s)`
      );
    }

    // Get count of tickets where user is a member
    const { count: memberTicketsCount } = await supabaseAdmin
      .from("ticket_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    // Remove user from ALL ticket memberships
    const { error: memberRemoveError } = await supabaseAdmin
      .from("ticket_members")
      .delete()
      .eq("user_id", userId);

    if (memberRemoveError) {
      console.error(
        "Error removing user from ticket members:",
        memberRemoveError
      );
      // Continue with deletion even if member removal fails
    } else if (memberTicketsCount > 0) {
      console.log(
        `✅ Removed user from ${memberTicketsCount} ticket membership(s)`
      );
    }

    // NOTE: Do NOT delete user's ticket messages - they should remain for history
    // Messages are only deleted when the ticket itself is deleted
    // User's messages will still show their name/email for historical record

    // NOTE: Do NOT delete user's chat messages - they should remain for history
    // await supabaseAdmin.from("chat_messages").delete().eq("sender_id", userId);

    // Remove user from chat groups (but keep their messages)
    await supabaseAdmin
      .from("chat_group_members")
      .delete()
      .eq("user_id", userId);

    // Delete user's notifications
    await supabaseAdmin.from("notifications").delete().eq("user_id", userId);

    // Delete user's OTP verifications
    await supabaseAdmin
      .from("otp_verifications")
      .delete()
      .eq("user_id", userId);

    // Remove user from starred users
    await supabaseAdmin
      .from("starred_users")
      .delete()
      .or(`user_id.eq.${userId},starred_user_id.eq.${userId}`);

    // Delete from Supabase Auth (if user exists in auth)
    const { error: authDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      console.error("Error deleting user from auth:", authDeleteError);
      // Continue with database deletion even if auth deletion fails
      // User might not exist in auth if added directly by admin
    }

    // Delete from users table (this should cascade delete related records)
    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", userId);

    if (deleteError) {
      console.error("Error deleting user from database:", deleteError);
      return errorResponse(res, "Failed to delete user from database", 500);
    }

    // Log admin action
    await supabaseAdmin.from("admin_actions").insert([
      {
        admin_id: adminId,
        action_type: "delete_user",
        target_user_id: userId,
        details: {
          user_email: user.email,
          user_name: user.name,
          user_role: user.role,
        },
      },
    ]);

    console.log(`✅ User deleted successfully:`, {
      userId,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
    });

    return successResponse(
      res,
      {
        deletedUserId: userId,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
      },
      `${
        user.role.charAt(0).toUpperCase() + user.role.slice(1)
      } deleted successfully`,
      200
    );
  } catch (error) {
    console.error("Delete user error:", error);
    return errorResponse(res, "Failed to delete user", 500);
  }
};

/**
 * Create user with name, email and role (for admin)
 * User receives email with password setup link
 * POST /api/admin/create-user-simple
 */
export const createUserSimple = async (req, res) => {
  try {
    const { name, email, role } = req.body;

    // Validate input
    if (!name || !email || !role) {
      return validationError(res, "Name, email and role are required");
    }

    // Validate name is not empty after trimming
    if (!name.trim()) {
      return validationError(res, "Name cannot be empty");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return validationError(res, "Invalid email format");
    }

    // Validate role
    const validRoles = ["client", "employee", "staff", "admin", "freelancer"];
    if (!validRoles.includes(role.toLowerCase())) {
      return validationError(
        res,
        "Invalid role. Must be one of: client, employee, staff, admin, freelancer"
      );
    }

    // Check if email already exists
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("email", email.toLowerCase())
      .single();

    if (existingUser) {
      return errorResponse(res, "User with this email already exists", 400);
    }

    // Generate a secure random token for password setup
    const crypto = await import("crypto");
    const setupToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create user in database only (not in Auth yet - that happens after password setup)
    const { data: newUser, error: createError } = await supabaseAdmin
      .from("users")
      .insert([
        {
          email: email.toLowerCase(),
          name: name.trim(),
          role: role.toLowerCase(),
          is_verified: false, // Not verified until they set password
          approval_status: "approved",
          password_setup_token: setupToken,
          password_setup_token_expiry: tokenExpiry.toISOString(),
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (createError) {
      console.error("Error creating user:", createError);
      return errorResponse(res, "Failed to create user", 500);
    }

    // Send password setup email
    const emailService = await import("../utils/emailService.js");
    await emailService.sendPasswordSetupEmail(
      email,
      name.trim(),
      role,
      setupToken
    );

    console.log("✅ User created successfully:", {
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
    });

    return successResponse(
      res,
      {
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
        },
        message: "User created successfully. Password setup email sent.",
      },
      "User created successfully",
      201
    );
  } catch (error) {
    console.error("Create user simple error:", error);
    return errorResponse(res, "Failed to create user", 500);
  }
};

/**
 * Generate a one-time invite link for a ticket
 * POST /api/admin/create-ticket-invite
 * body: { ticketId, maxUses?, expiresInMinutes?, role? }
 */
export const createTicketInvite = async (req, res) => {
  try {
    const { ticketId, maxUses = 1, expiresInMinutes = 1440, role } = req.body;
    const createdBy = req.user && req.user.id;

    console.log("🔗 Create ticket invite request:", {
      ticketId,
      maxUses,
      expiresInMinutes,
      role,
      createdBy,
      userEmail: req.user?.email,
    });

    // Validation
    if (!ticketId) {
      console.log("❌ Missing ticketId");
      return validationError(res, { ticketId: "Ticket ID is required" });
    }

    // Check ticket exists
    console.log("🔍 Checking if ticket exists...");
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("id, ticket_number, title")
      .eq("id", ticketId)
      .single();

    if (ticketError) {
      console.error("❌ Error fetching ticket:", ticketError);
      return errorResponse(res, "Error checking ticket", 500);
    }

    if (!ticket) {
      console.log("❌ Ticket not found:", ticketId);
      return errorResponse(res, "Ticket not found", 404);
    }

    console.log("✅ Ticket found:", {
      id: ticket.id,
      number: ticket.ticket_number,
      title: ticket.title,
    });

    // Generate secure token
    const crypto = await import("crypto");
    const token = crypto.randomBytes(32).toString("hex");

    const now = Date.now();
    const expirationMs = Number(expiresInMinutes) * 60 * 1000;
    const expiresAtTimestamp = now + expirationMs;
    const expiresAt = new Date(expiresAtTimestamp).toISOString();

    console.log("🎫 Generated token details:", {
      tokenLength: token.length,
      now: new Date(now).toISOString(),
      expiresInMinutes: Number(expiresInMinutes),
      expirationMs,
      expiresAtTimestamp,
      expiresAt,
      expiresInHours: Number(expiresInMinutes) / 60,
      validFor: `${expiresInMinutes} minutes (${
        Number(expiresInMinutes) / 60
      } hours)`,
    });

    // Check if ticket_invites table exists
    console.log("📋 Creating invite in database...");
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("ticket_invites")
      .insert([
        {
          ticket_id: ticketId,
          token,
          max_uses: Number(maxUses),
          uses: 0,
          expires_at: expiresAt,
          created_by: createdBy || null,
          role: role || null,
        },
      ])
      .select()
      .single();

    if (inviteError) {
      console.error("❌ Error creating ticket invite:", inviteError);

      // Check if table doesn't exist
      if (
        inviteError.message?.includes(
          'relation "ticket_invites" does not exist'
        )
      ) {
        console.error(
          "❌ Table ticket_invites does not exist! Run migration: sql-migrations/add-ticket-invites.sql"
        );
        return errorResponse(
          res,
          "Invite system not configured. Please run database migration.",
          500
        );
      }

      return errorResponse(
        res,
        `Failed to create invite link: ${inviteError.message}`,
        500
      );
    }

    console.log("✅ Invite created in database:", {
      inviteId: invite.id,
      ticketId: invite.ticket_id,
      maxUses: invite.max_uses,
      expiresAt: invite.expires_at,
    });

    // Get all configured frontend URLs
    const frontendUrls = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(",")
          .map((u) => u.trim())
          .filter((u) => u)
      : ["http://localhost:5173", "https://medzen-frontend.vercel.app"];

    console.log("🌐 Frontend URLs configured:", frontendUrls);

    // Generate links for all configured URLs
    const links = frontendUrls.map((url) => ({
      url: url,
      link: `${url.replace(/\/$/, "")}/accept-invite?token=${token}`,
      environment: url.includes("localhost") ? "development" : "production",
    }));

    // Primary link (production if available, otherwise first URL)
    const primaryLink =
      links.find((l) => l.environment === "production")?.link || links[0]?.link;

    console.log("✅ Invite links generated:", {
      primaryLink,
      totalLinks: links.length,
    });

    return successResponse(
      res,
      {
        invite: {
          id: invite.id,
          ticketId: invite.ticket_id,
          ticketNumber: ticket.ticket_number,
          ticketTitle: ticket.title,
          token: invite.token,
          link: primaryLink, // Primary link (production)
          links: links, // All available links
          expiresAt: invite.expires_at,
          maxUses: invite.max_uses,
          uses: invite.uses,
          role: invite.role,
        },
      },
      "Invite link generated successfully",
      201
    );
  } catch (error) {
    console.error("❌ createTicketInvite error:", error);
    return errorResponse(
      res,
      `Failed to generate invite: ${error.message}`,
      500
    );
  }
};

/**
 * Send OTP for admin email change
 * POST /api/admin/send-email-change-otp
 */
export const sendEmailChangeOTP = async (req, res) => {
  try {
    const { userId, newEmail } = req.body;

    if (!userId || !newEmail) {
      return validationError(res, {
        userId: !userId ? "User ID is required" : undefined,
        newEmail: !newEmail ? "New email is required" : undefined,
      });
    }

    // Get user details
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if new email is same as current
    if (newEmail === user.email) {
      return errorResponse(
        res,
        "New email must be different from current email",
        400
      );
    }

    // Check if new email is already in use
    const { data: existingUsers } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", newEmail);

    if (existingUsers && existingUsers.length > 0) {
      return errorResponse(res, "Email is already in use", 400);
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = hashOTP(otp);
    const expiresAt = getOTPExpiry(10);

    console.log("🔑 Generating OTP for email change:", {
      userId,
      newEmail,
      otp: otp, // Log actual OTP for debugging
      otpHash: otpHash.substring(0, 20) + "...",
      expiresAt,
    });

    // Delete old OTPs for this user
    const { error: deleteError } = await supabaseAdmin
      .from("otp_verifications")
      .delete()
      .eq("user_id", userId)
      .eq("verified", false);

    if (deleteError) {
      console.log(
        "⚠️ Error deleting old OTPs (may not exist):",
        deleteError.message
      );
    } else {
      console.log("🗑️ Deleted old OTPs for user:", userId);
    }

    // Store OTP
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
      console.error("❌ Error storing OTP:", otpError);
      return errorResponse(res, "Failed to generate OTP", 500);
    }

    console.log("✅ OTP stored successfully in database");

    // Send OTP to user's NEW email
    console.log("📧 Sending OTP email to:", newEmail);
    const { sendOTPEmail } = await import("../utils/emailService.js");
    await sendOTPEmail(newEmail, otp);
    console.log("✅ OTP email sent successfully to:", newEmail);

    return successResponse(
      res,
      {
        message: "OTP sent to user's new email address",
        debug: {
          sentTo: newEmail,
          otp: otp, // For debugging - remove in production
        },
      },
      "OTP sent successfully",
      200
    );
  } catch (error) {
    console.error("Send email change OTP error:", error);
    return errorResponse(res, "Failed to send OTP", 500);
  }
};

/**
 * Verify OTP and change email (admin)
 * POST /api/admin/verify-email-change-otp
 */
export const verifyEmailChangeOTP = async (req, res) => {
  try {
    const { userId, newEmail, otp } = req.body;

    console.log("🔐 Verifying email change OTP:", {
      userId,
      newEmail,
      otpProvided: otp,
      timestamp: new Date().toISOString(),
    });

    if (!userId || !newEmail || !otp) {
      return validationError(res, {
        userId: !userId ? "User ID is required" : undefined,
        newEmail: !newEmail ? "New email is required" : undefined,
        otp: !otp ? "OTP is required" : undefined,
      });
    }

    // Get latest OTP
    const { data: otpRecord, error: otpError } = await supabaseAdmin
      .from("otp_verifications")
      .select("*")
      .eq("user_id", userId)
      .eq("verified", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    console.log("📝 OTP Record Query Result:", {
      found: !!otpRecord,
      error: otpError?.message,
      userId: userId,
      recordUserId: otpRecord?.user_id,
      recordExpiry: otpRecord?.expires_at,
      recordHash: otpRecord?.otp_hash?.substring(0, 20) + "...",
    });

    if (otpError || !otpRecord) {
      console.error("❌ No OTP record found:", otpError);
      return errorResponse(res, "No valid OTP found", 400);
    }

    // Check expiry
    const { isOTPExpired } = await import("../utils/otp.js");
    const expired = isOTPExpired(otpRecord.expires_at);

    console.log("⏰ OTP Expiry Check:", {
      expiresAt: otpRecord.expires_at,
      currentTime: new Date().toISOString(),
      isExpired: expired,
    });

    if (expired) {
      return errorResponse(res, "OTP has expired", 400);
    }

    // Verify OTP
    const { verifyOTP } = await import("../utils/otp.js");
    const isValid = verifyOTP(otp, otpRecord.otp_hash);

    console.log("🔍 OTP Verification Result:", {
      providedOTP: otp,
      isValid: isValid,
    });

    if (!isValid) {
      console.error("❌ Invalid OTP provided");
      return errorResponse(res, "Invalid OTP", 400);
    }

    console.log("✅ OTP verified successfully");

    // Check email availability again
    const { data: existingUsers } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("email", newEmail)
      .neq("id", userId);

    if (existingUsers && existingUsers.length > 0) {
      return errorResponse(res, "Email is already in use", 400);
    }

    // Get current user email for rollback
    const { data: currentUser } = await supabaseAdmin
      .from("users")
      .select("email")
      .eq("id", userId)
      .single();

    console.log("👤 Current user data:", {
      userId,
      currentEmail: currentUser?.email,
    });

    // Check if user exists in Supabase Auth
    // Update email in database FIRST
    const { data: updatedUser, error: updateError } = await supabaseAdmin
      .from("users")
      .update({ email: newEmail })
      .eq("id", userId)
      .select()
      .single();

    if (updateError) {
      console.error("❌ Error updating email in database:", updateError);
      return errorResponse(res, "Failed to update email", 500);
    }

    console.log("✅ Database email updated successfully:", {
      userId,
      oldEmail: currentUser.email,
      newEmail: updatedUser.email,
    });

    // Check if user exists in Supabase Auth
    console.log("🔍 Checking if user exists in Supabase Auth...");
    const { data: authUser, error: authCheckError } =
      await supabaseAdmin.auth.admin.getUserById(userId);

    if (authCheckError || !authUser || !authUser.user) {
      // User not in Auth system - this is OK for admin-added users
      console.log("⚠️ User not found in Supabase Auth:", {
        error: authCheckError?.message,
        userId,
        note: "User was likely added directly to database by admin. Email updated in database only.",
      });

      // Clean up OTPs
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
          note: "Email updated in database only (user not in auth system)",
        },
        "Email changed successfully",
        200
      );
    }

    console.log("✅ User found in Supabase Auth:", {
      authUserId: authUser.user.id,
      authEmail: authUser.user.email,
    });

    // Update in Supabase Auth (user exists in auth)
    console.log("🔐 Attempting to update Supabase Auth email:", {
      userId,
      oldEmail: authUser.user.email,
      newEmail,
    });

    const { data: authUpdateData, error: authError } =
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: newEmail,
      });

    if (authError) {
      console.error("❌ Error updating auth email:", {
        error: authError,
        errorMessage: authError.message,
        errorStatus: authError.status,
        errorCode: authError.code,
        userId,
        newEmail,
      });

      // Rollback database change
      console.log("🔄 Rolling back database email change...");
      await supabaseAdmin
        .from("users")
        .update({ email: currentUser.email })
        .eq("id", userId);

      console.log("✅ Database rollback completed");

      return errorResponse(
        res,
        `Failed to update authentication email: ${authError.message}`,
        500
      );
    }

    console.log("✅ Supabase Auth email updated successfully:", {
      userId: authUpdateData?.user?.id,
      newEmail: authUpdateData?.user?.email,
    });

    // Clean up OTPs
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
        note: "Email updated in both database and auth system",
      },
      "Email changed successfully",
      200
    );
  } catch (error) {
    console.error("Verify email change OTP error:", error);
    return errorResponse(res, "Failed to change email", 500);
  }
};

export default {
  getPendingUsers,
  getApprovedUsers,
  approveUser,
  rejectUser,
  getAdminStats,
  getAllUsers,
  getUserTickets,
  updateUserEmail,
  sendUserOTP,
  addUser,
  createUserSimple,
  createTicketInvite,
  deleteUser,
  sendEmailChangeOTP,
  verifyEmailChangeOTP,
};

/**
 * Star a user (admin only)
 * POST /api/admin/users/:userId/star
 */
export const starUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id || req.user?.userId;

    if (!adminId) {
      return errorResponse(res, "Admin not authenticated", 401);
    }

    if (!userId) {
      return validationError(res, { userId: "User ID is required" });
    }

    // Check if user exists
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, name, email")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if already starred
    const { data: existingStar } = await supabaseAdmin
      .from("starred_users")
      .select("id")
      .eq("user_id", adminId)
      .eq("starred_user_id", userId)
      .single();

    if (existingStar) {
      console.log("⭐ User already starred");
      return successResponse(
        res,
        { isStarred: true },
        "User is already starred"
      );
    }

    // Star the user
    const { data: star, error: starError } = await supabaseAdmin
      .from("starred_users")
      .insert([
        {
          user_id: adminId,
          starred_user_id: userId,
          starred_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (starError) {
      console.error("Error starring user:", starError);
      return errorResponse(res, "Failed to star user", 500);
    }

    console.log(`⭐ User starred successfully: ${user.name || user.email}`);
    return successResponse(
      res,
      { isStarred: true, star },
      "User starred successfully"
    );
  } catch (error) {
    console.error("Star user error:", error);
    return errorResponse(res, "Failed to star user", 500);
  }
};

/**
 * Unstar a user (admin feature)
 * DELETE /api/admin/users/:userId/star
 */
export const unstarUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user?.id || req.user?.userId;

    if (!adminId) {
      return errorResponse(res, "Admin not authenticated", 401);
    }

    if (!userId) {
      return validationError(res, { userId: "User ID is required" });
    }

    // Unstar the user
    const { error: unstarError } = await supabaseAdmin
      .from("starred_users")
      .delete()
      .eq("user_id", adminId)
      .eq("starred_user_id", userId);

    if (unstarError) {
      console.error("Error unstarring user:", unstarError);
      return errorResponse(res, "Failed to unstar user", 500);
    }

    console.log(`⭐ User unstarred successfully`);
    return successResponse(
      res,
      { isStarred: false },
      "User unstarred successfully"
    );
  } catch (error) {
    console.error("Unstar user error:", error);
    return errorResponse(res, "Failed to unstar user", 500);
  }
};

/**
 * Get starred users for current admin
 * GET /api/admin/starred-users
 */
export const getStarredUsers = async (req, res) => {
  try {
    const adminId = req.user?.id || req.user?.userId;

    if (!adminId) {
      return errorResponse(res, "Admin not authenticated", 401);
    }

    // Get starred users with user details
    const { data: starredUsers, error } = await supabaseAdmin
      .from("starred_users")
      .select(
        `
        id,
        starred_at,
        starred_user:users!starred_users_starred_user_id_fkey (
          id,
          email,
          name,
          role,
          profile_picture,
          approval_status,
          department,
          created_at
        )
      `
      )
      .eq("user_id", adminId)
      .order("starred_at", { ascending: false });

    if (error) {
      console.error("Error fetching starred users:", error);
      return errorResponse(res, "Failed to fetch starred users", 500);
    }

    const users = starredUsers.map((star) => ({
      id: star.starred_user.id,
      email: star.starred_user.email,
      name: star.starred_user.name,
      role: star.starred_user.role,
      profilePicture: star.starred_user.profile_picture,
      approvalStatus: star.starred_user.approval_status,
      department: star.starred_user.department,
      createdAt: star.starred_user.created_at,
      starredAt: star.starred_at,
      isStarred: true,
    }));

    return successResponse(
      res,
      { users, count: users.length },
      "Starred users fetched successfully"
    );
  } catch (error) {
    console.error("Get starred users error:", error);
    return errorResponse(res, "Failed to fetch starred users", 500);
  }
};
