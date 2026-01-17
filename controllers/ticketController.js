import { supabaseAdmin } from "../config/supabase.js";
import {
  successResponse,
  errorResponse,
  validationError,
} from "../utils/responses.js";
import {
  createTicketAssignedNotification,
  createTicketCreationNotification,
} from "../utils/notificationHelper.js";
import { sendTicketStatusWhatsApp, sendPaymentStageWhatsApp } from "../utils/whatsappService.js";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Buffer } from "buffer";
import ExcelJS from "exceljs";

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate sequential ticket number in format: MZI 0001, MZI 0002, etc.
 */
const generateTicketNumber = async () => {
  try {
    // Get the latest ticket number (use limit without single to avoid error when no tickets)
    const { data: tickets, error } = await supabaseAdmin
      .from("tickets")
      .select("ticket_number")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("❌ Error fetching latest ticket:", error);
      return "MZI 0001"; // Fallback to first number
    }

    const latestTicket = tickets?.[0];

    if (latestTicket && latestTicket.ticket_number) {
      // Extract the number part from "MZI 0001" format
      const match = latestTicket.ticket_number.match(/MZI\s*(\d+)/i);
      if (match) {
        const lastNumber = parseInt(match[1], 10);
        const nextNumber = lastNumber + 1;
        return `MZI ${String(nextNumber).padStart(4, "0")}`;
      }
    }

    // If no tickets exist or parsing failed, start from MZI 0001
    return "MZI 0001";
  } catch (error) {
    console.error("❌ Error generating ticket number:", error);
    return "MZI 0001"; // Fallback
  }
};

/**
 * Generate unique ticket UID in format: MED 12345 (5 random digits)
 */
const generateTicketUID = async () => {
  try {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      // Generate 5 random digits
      const randomDigits = Math.floor(10000 + Math.random() * 90000);
      const uid = `MED ${randomDigits}`;

      // Check if this UID already exists
      const { data: existingTicket, error } = await supabaseAdmin
        .from("tickets")
        .select("id")
        .eq("uid", uid)
        .maybeSingle(); // Use maybeSingle instead of single to avoid error when not found

      if (error) {
        console.error("❌ Error checking UID uniqueness:", error);
        attempts++;
        continue;
      }

      if (!existingTicket) {
        return uid;
      }

      attempts++;
    }

    // Fallback: use timestamp if all random attempts failed
    const fallbackUID = `MED ${Date.now().toString().slice(-5)}`;
    console.log("⚠️ Using fallback UID:", fallbackUID);
    return fallbackUID;
  } catch (error) {
    console.error("❌ Error generating ticket UID:", error);
    // Emergency fallback
    return `MED ${Date.now().toString().slice(-5)}`;
  }
};

/**
 * Create a new ticket
 * POST /api/tickets
 */
export const createTicket = async (req, res) => {
  try {
    console.log("🎫 === CREATE TICKET REQUEST START ===");
    console.log("📥 Request body:", JSON.stringify(req.body, null, 2));
    console.log("👤 User ID:", req.user?.id);
    console.log("👤 User role:", req.user?.role);
    console.log("📧 User email:", req.user?.email);
    console.log("🌍 Environment:", process.env.NODE_ENV);
    console.log("🔗 Request origin:", req.headers.origin);
    console.log("🔑 Has Authorization:", !!req.headers.authorization);

    // Check if user exists in request
    if (!req.user || !req.user.id) {
      console.error("❌ No user in request!");
      console.error("❌ Headers:", JSON.stringify(req.headers, null, 2));
      return errorResponse(res, "Authentication required", 401);
    }

    const {
      title,
      description,
      priority,
      ticketNumber,
      uid,
      points,
      memberIds,
      files,
    } = req.body;

    const userId = req.user.id;

    console.log("📋 Parsed fields:", {
      hasTitle: !!title,
      hasDescription: !!description,
      priority: priority,
      pointsType: typeof points,
      pointsLength: Array.isArray(points) ? points.length : "not array",
      memberIdsType: typeof memberIds,
      memberIdsLength: Array.isArray(memberIds)
        ? memberIds.length
        : "not array",
      filesType: typeof files,
      filesLength: Array.isArray(files) ? files.length : "not array",
    });

    console.log("🎯 Creating ticket with files:", files);
    console.log("🎯 Files type:", typeof files);
    console.log("🎯 Files length:", files?.length);

    // Validation
    if (!title) {
      return validationError(res, { field: "Title is required" });
    }

    // Get user details from database
    const { data: user, error: userFetchError } = await supabaseAdmin
      .from("users")
      .select("id, email, name, role, approval_status")
      .eq("id", userId)
      .single();

    if (userFetchError || !user) {
      console.error("❌ Error fetching user from database:", {
        error: userFetchError,
        userId: userId,
        requestUser: req.user,
      });
      return errorResponse(res, "User not found in database", 404);
    }

    console.log("📊 User data comparison:", {
      fromJWT: {
        id: req.user?.id,
        email: req.user?.email,
        role: req.user?.role,
      },
      fromDatabase: {
        id: user.id,
        email: user.email,
        role: user.role,
        approval_status: user.approval_status,
      },
    });

    // Check if user is approved (this might be the issue!)
    if (user.approval_status !== "approved") {
      console.log("❌ User not approved:", {
        userEmail: user.email,
        userRole: user.role,
        approvalStatus: user.approval_status,
      });
      return errorResponse(
        res,
        "Your account is not approved yet. Please wait for admin approval.",
        403
      );
    }

    // Check permissions: All admins and clients can create tickets
    if (user.role !== "admin" && user.role !== "client") {
      console.log("❌ Unauthorized ticket creation attempt:", {
        userEmail: user.email,
        userRole: user.role,
        allowedRoles: ["admin", "client"],
        timestamp: new Date().toISOString(),
      });
      return errorResponse(
        res,
        "Only admins and clients can create tickets",
        403
      );
    }

    console.log("✅ Ticket creation authorized:", {
      userEmail: user.email,
      userRole: user.role,
      approvalStatus: user.approval_status,
      isAdmin: user.role === "admin",
      isClient: user.role === "client",
    });

    // Generate ticket number and UID (sequential and unique)
    const finalTicketNumber = ticketNumber || (await generateTicketNumber());
    const finalUid = uid || (await generateTicketUID());

    console.log("🎫 Generated ticket number:", finalTicketNumber);
    console.log("🆔 Generated ticket UID:", finalUid);

    // Process uploaded files - upload to Supabase Storage
    let processedFiles = [];
    if (files && files.length > 0) {
      console.log("🎯 Processing uploaded files:", files);

      processedFiles = await Promise.all(
        files.map(async (file) => {
          if (file.data) {
            try {
              // Generate unique filename
              const timestamp = Date.now();
              const randomStr = Math.random().toString(36).substring(7);
              const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
              const fileName = `${timestamp}_${randomStr}_${sanitizedName}`;
              const filePath = `tickets/${fileName}`;

              // Convert base64 to buffer
              const base64Data = file.data.replace(/^data:.*,/, "");
              const fileBuffer = Buffer.from(base64Data, "base64");

              // Upload to Supabase Storage
              const { data: uploadData, error: uploadError } =
                await supabaseAdmin.storage
                  .from("ticket-files")
                  .upload(filePath, fileBuffer, {
                    contentType: file.type,
                    upsert: false,
                  });

              if (uploadError) {
                console.error(
                  "❌ Error uploading file to Supabase:",
                  uploadError
                );
                throw uploadError;
              }

              // Get public URL
              const { data: urlData } = supabaseAdmin.storage
                .from("ticket-files")
                .getPublicUrl(filePath);

              console.log("✅ Uploaded file to Supabase:", fileName);

              return {
                name: file.name,
                size: file.size,
                type: file.type,
                url: urlData.publicUrl,
              };
            } catch (error) {
              console.error("❌ Error processing file:", file.name, error);
              // Return file metadata without URL if upload fails
              return {
                name: file.name,
                size: file.size,
                type: file.type,
                url: null,
                error: error.message,
              };
            }
          } else {
            // Just metadata
            return {
              name: file.name,
              size: file.size,
              type: file.type,
              url: null,
            };
          }
        })
      );
    }

    // Create ticket with creation_files
    const ticketData = {
      ticket_number: finalTicketNumber,
      uid: finalUid,
      title,
      description,
      priority: priority || "P3",
      status: "Created",
      created_by: userId,
      points: points || [],
      creation_files: processedFiles,
    };

    console.log("💾 === INSERTING TICKET TO DATABASE ===");
    console.log(
      "📄 Ticket data to insert:",
      JSON.stringify(ticketData, null, 2)
    );

    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .insert([ticketData])
      .select()
      .single();

    console.log("📊 Insert result:", {
      success: !ticketError,
      hasTicket: !!ticket,
      ticketId: ticket?.id,
      error: ticketError
        ? {
          message: ticketError.message,
          code: ticketError.code,
          details: ticketError.details,
          hint: ticketError.hint,
        }
        : null,
    });

    if (ticketError) {
      console.error("❌ Error creating ticket:", {
        error: ticketError,
        message: ticketError.message,
        code: ticketError.code,
        details: ticketError.details,
        hint: ticketError.hint,
        ticketData: {
          ticket_number: ticketData.ticket_number,
          uid: ticketData.uid,
          title: ticketData.title,
          hasFiles: processedFiles.length > 0,
        },
      });
      return errorResponse(
        res,
        `Failed to create ticket: ${ticketError.message || "Unknown error"}`,
        500
      );
    }

    // Get all approved admin users
    const { data: allAdmins, error: adminsError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("role", "admin")
      .eq("approval_status", "approved");

    if (adminsError) {
      console.error("❌ Error fetching admins:", adminsError);
      // Don't fail ticket creation if admin fetch fails, just log it
    }

    // CRITICAL: Always include the creator (userId) in members
    // Combine: creator + requested members + all admins (avoid duplicates)
    const adminIds = allAdmins?.map((a) => a.id) || [];
    const requestedMemberIds = Array.isArray(memberIds)
      ? memberIds.filter((id) => id)
      : [];
    const allMemberIds = [
      ...new Set([userId, ...requestedMemberIds, ...adminIds]),
    ];

    console.log("🎯 Adding members to ticket:", {
      creator: userId,
      creatorRole: user.role,
      requestedMembers: requestedMemberIds.length,
      requestedMemberIds: requestedMemberIds,
      admins: adminIds.length,
      adminIds: adminIds,
      total: allMemberIds.length,
      allMemberIds: allMemberIds,
    });

    // Add members to ticket (including all admins) - CRITICAL STEP
    if (allMemberIds.length > 0) {
      const members = allMemberIds.map((memberId) => ({
        ticket_id: ticket.id,
        user_id: memberId,
        added_by: userId,
        can_message_client: true, // All members can message by default
      }));

      console.log("💾 Inserting ticket members:", {
        ticketId: ticket.id,
        memberCount: members.length,
        creatorId: userId,
        members: members.map((m) => ({
          user_id: m.user_id,
          can_message_client: m.can_message_client,
        })),
        hasDuplicates:
          members.length !== new Set(members.map((m) => m.user_id)).size,
      });

      // CRITICAL: Try insert with upsert to handle any potential duplicates gracefully
      const { data: insertedMembers, error: membersError } = await supabaseAdmin
        .from("ticket_members")
        .upsert(members, {
          onConflict: "ticket_id,user_id",
          ignoreDuplicates: false,
        })
        .select("*");

      if (membersError) {
        console.error("❌ CRITICAL ERROR adding members:", {
          error: membersError,
          code: membersError.code,
          message: membersError.message,
          details: membersError.details,
          hint: membersError.hint,
        });
        // This is critical - if members aren't added, the creator can't message
        return errorResponse(
          res,
          `Failed to add members to ticket: ${membersError.message}`,
          500
        );
      }

      console.log(
        `✅ Successfully added ${insertedMembers.length} member(s) to ticket:`,
        {
          ticketId: ticket.id,
          insertedMemberIds: insertedMembers.map((m) => m.user_id),
          creatorIncluded: insertedMembers.some((m) => m.user_id === userId),
        }
      );

      // Create notifications for each added member (except the creator)
      for (const memberId of allMemberIds) {
        if (memberId !== userId) {
          await createTicketAssignedNotification(ticket.id, memberId, userId);
        }
      }

      // IMPORTANT: Notify admins/employees about new ticket creation
      // This will NOT notify the creator (handled inside the function)
      await createTicketCreationNotification(ticket.id, userId);
    } else {
      console.error(
        "❌ CRITICAL: No members to add to ticket! This should never happen."
      );
      return errorResponse(res, "No members to add to ticket", 500);
    }

    // Note: Creator and all admins are already added as members above in the main member addition logic
    // Files are already processed and stored in creation_files field

    // Fetch the complete ticket with members for the response
    const { data: ticketMembers } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id, can_message_client")
      .eq("ticket_id", ticket.id);

    // Get user details for each member
    const membersWithDetails = await Promise.all(
      (ticketMembers || []).map(async (member) => {
        const { data: memberUser } = await supabaseAdmin
          .from("users")
          .select("id, name, email, profile_picture, role")
          .eq("id", member.user_id)
          .single();
        return {
          ...member,
          users: memberUser,
        };
      })
    );

    const creatorIsIncluded = membersWithDetails.some(
      (m) => m.user_id === userId
    );

    console.log("🎯 Ticket created successfully with members:", {
      ticketId: ticket.id,
      creatorId: userId,
      memberCount: membersWithDetails.length,
      memberIds: membersWithDetails.map((m) => m.user_id),
      creatorIsIncluded: creatorIsIncluded,
    });

    // CRITICAL: Verify creator is in the members list
    if (!creatorIsIncluded) {
      console.error(
        "❌ CRITICAL BUG: Creator was not added to members despite insertion!"
      );
      console.error("This should NEVER happen. Check database constraints.");
      // Try to recover by fetching again
      const { data: recheckMembers } = await supabaseAdmin
        .from("ticket_members")
        .select("user_id")
        .eq("ticket_id", ticket.id);

      console.error("❌ Recheck query result:", {
        ticketId: ticket.id,
        creatorId: userId,
        foundMembers: recheckMembers?.map((m) => m.user_id) || [],
      });
    }

    // Enrich ticket response with members
    const enrichedTicket = {
      ...ticket,
      members: membersWithDetails,
      // EXPLICIT fields for frontend validation
      creatorId: userId,
      creatorIsIncluded: creatorIsIncluded,
      memberCount: membersWithDetails.length,
      memberUserIds: membersWithDetails.map((m) => m.user_id),
    };

    return successResponse(
      res,
      { ticket: enrichedTicket },
      "Ticket created successfully",
      201
    );
  } catch (error) {
    console.error("❌ CREATE TICKET ERROR:", {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id,
      userEmail: req.user?.email,
      body: req.body,
      errorName: error.name,
      errorCode: error.code,
    });

    // Provide more specific error messages
    if (error.code === "PGRST116") {
      return errorResponse(
        res,
        "Database connection error. Please try again.",
        500
      );
    }
    if (error.message?.includes("JWT")) {
      return errorResponse(
        res,
        "Authentication token invalid. Please login again.",
        401
      );
    }

    return errorResponse(res, `Failed to create ticket: ${error.message}`, 500);
  }
};

/**
 * Get all tickets for a user
 * GET /api/tickets
 * - Admin: sees ALL tickets
 * - Employee: sees ALL tickets (read-only unless member)
 * - Client: ONLY sees tickets they created OR tickets they are members of
 * - Other users: only see tickets they are members of
 */
export const getUserTickets = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log("Fetching tickets for user:", userId);

    // Get user role
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (userError) {
      console.error("Error fetching user:", userError);
      return errorResponse(res, "Failed to fetch user details", 500);
    }

    // OPTIMIZED QUERY STRATEGY: BATCH FETCHING
    // 1. Fetch relevant tickets first
    // 2. Collect all User IDs and File relationships needed
    // 3. Batch fetch all needed users and files in parallel
    // 4. Map data back to tickets in memory
    // This avoids N+1 queries AND avoids "Foreign Key not found" errors with Joins

    let query = supabaseAdmin
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: false });

    // Apply role-based filtering
    if (user.role === "admin" || user.role === "employee") {
      console.log(`User is ${user.role} - fetching all tickets`);
    } else {
      console.log(`User is ${user.role} - fetching only relevant tickets`);

      const { data: createdTickets } = await supabaseAdmin
        .from("tickets")
        .select("id")
        .eq("created_by", userId);

      const { data: memberTickets } = await supabaseAdmin
        .from("ticket_members")
        .select("ticket_id")
        .eq("user_id", userId);

      const createdIds = createdTickets?.map(t => t.id) || [];
      const memberIds = memberTickets?.map(m => m.ticket_id) || [];
      const allTicketIds = [...new Set([...createdIds, ...memberIds])];

      if (allTicketIds.length === 0) {
        console.log("No tickets found for user");
        return successResponse(res, { tickets: [] }, "No tickets found");
      }

      query = query.in("id", allTicketIds);
    }

    const { data: tickets, error: ticketsError } = await query;

    if (ticketsError) {
      console.error("Error fetching tickets:", ticketsError);
      return errorResponse(res, `Failed to fetch tickets: ${ticketsError.message}`, 500);
    }

    if (!tickets || tickets.length === 0) {
      console.log("No tickets found");
      return successResponse(res, { tickets: [] }, "No tickets found");
    }

    console.log(`📋 Fetched ${tickets.length} tickets - starting batch data load`);

    // --- BATCH FETCH STEPS (SAFE BATCHED PARALLEL) ---
    // Process in chunks to prevent memory spikes / connection exhaustion
    const ticketIds = tickets.map(t => t.id);
    const BATCH_SIZE = 50;

    let allMembers = [];
    let allFiles = [];
    let starredByIds = [];
    let recentMessages = [];

    // Global User Map for this request (Incremental Load)
    let usersMap = new Map();
    let lastMessagesMap = new Map();

    for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
      const chunkIds = ticketIds.slice(i, i + BATCH_SIZE);

      const [chunkMembers, chunkFiles, chunkStarred, chunkMessages] = await Promise.all([
        // A. Members
        supabaseAdmin.from("ticket_members").select("ticket_id, user_id, role").in("ticket_id", chunkIds),
        // B. Files
        supabaseAdmin.from("ticket_files").select("*").in("ticket_id", chunkIds),
        // C. Starred
        supabaseAdmin.from("starred_tickets").select("ticket_id").eq("user_id", userId).in("ticket_id", chunkIds),
        // D. Recent Messages
        supabaseAdmin.from("ticket_messages").select("ticket_id, message, message_type, created_at, sender_id")
          .in("ticket_id", chunkIds).order("created_at", { ascending: false }).limit(chunkIds.length * 5)
      ]);

      // Accumulate Data
      if (chunkMembers.data) allMembers.push(...chunkMembers.data);
      if (chunkFiles.data) allFiles.push(...chunkFiles.data);
      if (chunkStarred.data) starredByIds.push(...chunkStarred.data.map(s => s.ticket_id));
      if (chunkMessages.data) recentMessages.push(...chunkMessages.data);

      // --- INCREMENTAL USER FETCH (Fix 502 URL Overflow) ---
      // Identify users needed for THIS chunk
      const chunkTickets = tickets.filter(t => chunkIds.includes(t.id));
      const chunkCreatorIds = chunkTickets.map(t => t.created_by);
      const chunkMemberUserIds = (chunkMembers.data || []).map(m => m.user_id);
      const chunkMessageSenderIds = (chunkMessages.data || []).map(m => m.sender_id);

      const neededUserIds = [...new Set([...chunkCreatorIds, ...chunkMemberUserIds, ...chunkMessageSenderIds])].filter(Boolean);
      const missingUserIds = neededUserIds.filter(id => !usersMap.has(id));

      if (missingUserIds.length > 0) {
        const { data: fetchedUsers } = await supabaseAdmin
          .from("users")
          .select("id, name, email, role, profile_picture")
          .in("id", missingUserIds);

        if (fetchedUsers) {
          fetchedUsers.forEach(u => usersMap.set(u.id, u));
        }
      }

      // Fill lastMessagesMap for this chunk
      if (chunkMessages.data) {
        for (const msg of chunkMessages.data) {
          if (!lastMessagesMap.has(msg.ticket_id)) {
            lastMessagesMap.set(msg.ticket_id, msg);
          }
        }
      }
    }

    const starredSet = new Set(starredByIds);

    // 3. Messages processed in loop ^^^

    // 4. Fallback Fetch for inactive tickets
    // Calculate needing fallback
    let ticketsNeedingFallback = new Set(ticketIds);
    for (const [tid] of lastMessagesMap) {
      ticketsNeedingFallback.delete(tid);
    }

    if (ticketsNeedingFallback.size > 0) {
      const fallbackIds = Array.from(ticketsNeedingFallback);

      for (let i = 0; i < fallbackIds.length; i += BATCH_SIZE) {
        const chunk = fallbackIds.slice(i, i + BATCH_SIZE);

        const batchPromises = chunk.map(async (missingTicketId) => {
          const { data: fallbackMsg } = await supabaseAdmin
            .from("ticket_messages")
            .select("ticket_id, message, message_type, created_at, sender_id")
            .eq("ticket_id", missingTicketId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (fallbackMsg) {
            lastMessagesMap.set(missingTicketId, fallbackMsg);
          }
        });

        await Promise.all(batchPromises);
      }

      // Final User Fetch for Fallback Senders
      const fallbackSenders = Array.from(ticketsNeedingFallback).map(tid => lastMessagesMap.get(tid)?.sender_id).filter(Boolean);
      const missingFallbackSenders = fallbackSenders.filter(id => !usersMap.has(id));
      if (missingFallbackSenders.length > 0) {
        const { data: fetchFallbackUsers } = await supabaseAdmin.from("users").select("id, name, email, role, profile_picture").in("id", [...new Set(missingFallbackSenders)]);
        if (fetchFallbackUsers) fetchFallbackUsers.forEach(u => usersMap.set(u.id, u));
      }
    }

    // 5. Consolidated User Fetch: REMOVED (Handled incrementally)



    // 7. Map everything back
    const ticketsWithDetails = await Promise.all(tickets.map(async (ticket) => {
      // Creator
      const creator = usersMap.get(ticket.created_by) || {
        id: ticket.created_by,
        name: "Deleted User",
        email: "deleted@user.com",
        role: "unknown",
        profile_picture: null,
      };

      // Members
      const myMembers = allMembers
        .filter(m => m.ticket_id === ticket.id)
        .map(m => {
          const u = usersMap.get(m.user_id);
          if (!u) return null;
          return { ...u, role: m.role || u.role }; // Support override role in member table if exists
        })
        .filter(Boolean);

      // Files
      const myFiles = allFiles.filter(f => f.ticket_id === ticket.id);

      // Last Message (Retrieved from Batch Map)
      let lastMessage = null;
      let lastMessageSender = null;

      const lastMsgData = lastMessagesMap.get(ticket.id);

      if (lastMsgData) {
        if (lastMsgData.message_type === "text") {
          lastMessage = lastMsgData.message;
        } else {
          lastMessage = lastMsgData.message_type === "file" ? "📎 Sent a file" : "🖼️ Sent an image";
        }
        const sender = usersMap.get(lastMsgData.sender_id);
        lastMessageSender = sender?.name || "Unknown";
      }

      return {
        id: ticket.id,
        ticketNumber: ticket.ticket_number,
        uid: ticket.uid,
        title: ticket.title,
        description: ticket.description,
        priority: ticket.priority,
        status: ticket.status,
        points: ticket.points || [],
        createdBy: creator,
        members: myMembers,
        files: myFiles,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        lastMessage: lastMessage,
        lastMessageSender: lastMessageSender,
        isStarred: starredSet.has(ticket.id),
        // Legacy fields
        creator_name: creator.name,
        creator_email: creator.email,
        payment_stages: ticket.payment_stages
      };
    }));

    console.log(
      `Found ${ticketsWithDetails.length} tickets for user (role: ${user.role})`
    );
    return successResponse(
      res,
      { tickets: ticketsWithDetails },
      "Tickets fetched successfully"
    );
  } catch (error) {
    console.error("Get user tickets error:", error);
    console.error("Error stack:", error.stack);
    return errorResponse(res, `Server error: ${error.message}`, 500);
  }
};

/**
 * Get single ticket details
 * GET /api/tickets/:ticketId
 */
export const getTicketDetails = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;

    // Get user details to check role
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    // Check if user is a member of this ticket (unless they're admin or employee)
    const { data: membership } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    // Allow access if user is admin, employee, or a member of the ticket
    if (!membership && user.role !== "admin" && user.role !== "employee") {
      return errorResponse(res, "You do not have access to this ticket", 403);
    }

    // Get ticket details
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("*")
      .eq("id", ticketId)
      .single();

    if (ticketError) {
      console.error("Error fetching ticket:", ticketError);
      return errorResponse(res, "Ticket not found", 404);
    }

    // Get created by user (handle deleted users)
    const { data: createdByUser } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role, profile_picture")
      .eq("id", ticket.created_by)
      .single();

    // If creator is deleted, use placeholder
    const createdByUserInfo = createdByUser || {
      id: ticket.created_by,
      name: "Deleted User",
      email: "deleted@user.com",
      role: "unknown",
      profile_picture: null,
    };

    // Get ticket members with can_message_client permission
    const { data: ticketMembers } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id, role, added_at, can_message_client")
      .eq("ticket_id", ticketId);

    // Get user details for members (filter out deleted users)
    const membersWithDetails = await Promise.all(
      (ticketMembers || []).map(async (member) => {
        const { data: user } = await supabaseAdmin
          .from("users")
          .select("id, name, email, profile_picture, role")
          .eq("id", member.user_id)
          .single();

        // If user is deleted, return null
        if (!user) {
          return null;
        }

        return {
          ...member,
          users: user,
        };
      })
    );

    // Filter out null values (deleted users)
    const validMembersWithDetails = membersWithDetails.filter(
      (member) => member !== null
    );

    // Get ticket files
    const { data: ticketFiles } = await supabaseAdmin
      .from("ticket_files")
      .select("*")
      .eq("ticket_id", ticketId);

    // Get files with uploader details
    const filesWithUploader = await Promise.all(
      (ticketFiles || []).map(async (file) => {
        const { data: uploader } = await supabaseAdmin
          .from("users")
          .select("id, name")
          .eq("id", file.uploaded_by)
          .single();

        return {
          ...file,
          uploaded_by_user: uploader,
        };
      })
    );

    // Get ticket messages - filter by message_mode and join date based on user role
    let messagesQuery = supabaseAdmin
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(50);

    // Apply message filtering based on user role and membership
    const isAdmin = user.role === "admin";
    const isEmployee = user.role === "employee";
    const isCreator = ticket.created_by === userId;

    // If user is a client, only show client-mode messages
    if (user.role === "client") {
      messagesQuery = messagesQuery.eq("message_mode", "client");
    }

    // Apply join date filtering for non-admin, non-employee, non-creator users
    // ADMINS: See ALL messages (no filtering)
    // EMPLOYEES: See ALL messages (no filtering) - they need full context
    // TICKET CREATORS: See ALL messages
    // CLIENTS/FREELANCERS: Only see messages after they were added to the ticket
    const shouldFilterByJoinDate =
      !isAdmin &&
      !isEmployee &&
      !isCreator &&
      membership &&
      membership.added_at;

    if (shouldFilterByJoinDate) {
      console.log(
        "🔍 FILTERING APPLIED in getTicketDetails: Client/Freelancer - only after",
        membership.added_at
      );
      messagesQuery = messagesQuery.gte("created_at", membership.added_at);
    } else {
      console.log(
        "✅ NO JOIN DATE FILTERING in getTicketDetails: Admin/Employee/Creator - showing ALL messages",
        {
          isAdmin,
          isEmployee,
          isCreator,
          reason: isAdmin
            ? "USER IS ADMIN"
            : isEmployee
              ? "USER IS EMPLOYEE"
              : isCreator
                ? "USER IS CREATOR"
                : "NO JOIN DATE",
        }
      );
    }

    const { data: ticketMessages } = await messagesQuery;

    // Get messages with sender details and uploaded files
    const messagesWithSender = await Promise.all(
      (ticketMessages || []).map(async (message) => {
        const { data: sender, error: senderError } = await supabaseAdmin
          .from("users")
          .select("id, name, profile_picture")
          .eq("id", message.sender_id)
          .single();

        if (senderError) {
          console.error(
            "Error fetching sender for message:",
            message.id,
            senderError
          );
        }

        // Get files uploaded with this message (within 5 seconds of message creation)
        const messageTime = new Date(message.created_at);
        const before = new Date(messageTime.getTime() - 5000); // 5 seconds before
        const after = new Date(messageTime.getTime() + 5000); // 5 seconds after

        const { data: uploadedFiles } = await supabaseAdmin
          .from("ticket_files")
          .select("*")
          .eq("ticket_id", ticketId)
          .eq("uploaded_by", message.sender_id)
          .gte("uploaded_at", before.toISOString())
          .lte("uploaded_at", after.toISOString());

        // Fetch who has seen this message
        let seenBy = [];
        const { data: seenRecords } = await supabaseAdmin
          .from('message_seen_by')
          .select('user_id, seen_at, users!message_seen_by_user_id_fkey(id, name, role, profile_picture)')
          .eq('message_id', message.id);

        if (seenRecords) {
          seenBy = seenRecords.map(record => ({
            userId: record.user_id,
            userName: record.users?.name || 'Unknown',
            userRole: record.users?.role,
            profilePicture: record.users?.profile_picture,
            seenAt: record.seen_at
          }));
        }

        return {
          ...message,
          user: sender || {
            id: message.sender_id,
            name: "Unknown User",
            profile_picture: null,
          },
          uploadedFiles: uploadedFiles || [],
          seen_by: seenBy,
        };
      })
    );

    const enrichedTicket = {
      ...ticket,
      created_by_user: createdByUserInfo, // Use createdByUserInfo instead of createdByUser
      ticket_members: validMembersWithDetails, // Use validMembersWithDetails instead of membersWithDetails
      ticket_files: filesWithUploader,
      ticket_messages: messagesWithSender,
      creation_files: ticket.creation_files || [], // Ensure creation_files are included
      is_member: !!membership || user.role === "admin", // Include membership status for frontend
    };

    console.log(
      "🎯 Returning ticket with creation_files:",
      enrichedTicket.creation_files
    );
    console.log("🎯 Original ticket creation_files:", ticket.creation_files);

    return successResponse(
      res,
      { ticket: enrichedTicket },
      "Ticket details fetched successfully"
    );
  } catch (error) {
    console.error("Get ticket details error:", error);
    return errorResponse(res, "Failed to fetch ticket details", 500);
  }
};

/**
 * Add members to a ticket
 * POST /api/tickets/:ticketId/members
 */
export const addTicketMembers = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { memberIds } = req.body;
    const userId = req.user.id;

    if (!memberIds || memberIds.length === 0) {
      return validationError(res, { field: "Member IDs are required" });
    }

    // Get user role and name
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role, name")
      .eq("id", userId)
      .single();

    // Check permissions: Admin can always add members, employees can add members if they are already members of the ticket
    if (user.role !== "admin" && user.role !== "employee") {
      return errorResponse(
        res,
        "Only admin and employees can add members to tickets",
        403
      );
    }

    // If user is an employee, verify they are a member of this ticket
    if (user.role === "employee") {
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        // If employee is not a member, check if they are trying to add ONLY themselves
        // memberIds is an array of strings
        const addingOthers = memberIds.some((id) => id !== userId);

        if (addingOthers) {
          return errorResponse(
            res,
            "You must be a member of this ticket to add other members. You can only add yourself.",
            403
          );
        }
      }
    }

    // Get ticket details
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("ticket_number, title")
      .eq("id", ticketId)
      .single();

    // Add members
    const members = memberIds.map((memberId) => ({
      ticket_id: ticketId,
      user_id: memberId,
      added_by: userId,
      can_message_client: false, // Default to false, admins can grant permission later
    }));

    const { error: membersError } = await supabaseAdmin
      .from("ticket_members")
      .insert(members);

    if (membersError) {
      console.error("Error adding members:", membersError);
      return errorResponse(res, "Failed to add members", 500);
    }

    // Create notifications for each new member
    const notifications = memberIds.map((memberId) => ({
      user_id: memberId,
      type: "ticket_assigned",
      title: "Added to Ticket",
      message: `You have been added to ticket "${ticket?.title || ticket?.ticket_number || "Untitled"
        }"`,
      related_ticket_id: ticketId,
      related_user_id: userId,
      is_read: false,
    }));

    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert(notifications);

    if (notificationError) {
      console.error("Error creating notifications:", notificationError);
      // Don't fail the request if notifications fail
    }

    return successResponse(res, {}, "Members added successfully");
  } catch (error) {
    console.error("Add ticket members error:", error);
    return errorResponse(res, "Failed to add members", 500);
  }
};

/**
 * Add employees to a ticket (Employee-specific endpoint)
 * POST /api/tickets/:ticketId/add-employees
 */
export const addEmployeesToTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { employeeIds } = req.body;
    const userId = req.user.id;

    console.log("🎯 Employee adding other employees to ticket:", {
      ticketId,
      requesterId: userId,
      employeeIds,
    });

    if (!employeeIds || employeeIds.length === 0) {
      return validationError(res, { field: "Employee IDs are required" });
    }

    // Get user details
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role, name, email")
      .eq("id", userId)
      .single();

    if (!user) {
      return errorResponse(res, "User not found", 404);
    }

    // Check if user is admin or employee
    if (user.role !== "admin" && user.role !== "employee") {
      return errorResponse(
        res,
        "Only admin and employees can add employees to tickets",
        403
      );
    }

    // If user is an employee, verify they are a member of this ticket
    if (user.role === "employee") {
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        // If employee is not a member, check if they are trying to add ONLY themselves
        // employeeIds is an array of strings
        const addingOthers = employeeIds.some((id) => id !== userId);

        if (addingOthers) {
          return errorResponse(
            res,
            "You must be a member of this ticket to add other employees. You can only add yourself.",
            403
          );
        }
      }
    }

    // Get ticket details
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("ticket_number, title, created_by")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return errorResponse(res, "Ticket not found", 404);
    }

    // Validate that all provided IDs are actually employees or admins
    const { data: employeesToAdd, error: employeesError } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role, profile_picture")
      .in("id", employeeIds)
      .in("role", ["employee", "admin"])
      .eq("approval_status", "approved");

    if (employeesError) {
      console.error("Error fetching employees:", employeesError);
      return errorResponse(res, "Failed to validate employees", 500);
    }

    if (!employeesToAdd || employeesToAdd.length === 0) {
      return errorResponse(
        res,
        "No valid employees found with provided IDs",
        400
      );
    }

    // Filter out employees who are already members
    const { data: existingMembers } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id")
      .eq("ticket_id", ticketId)
      .in("user_id", employeeIds);

    const existingMemberIds = new Set(
      (existingMembers || []).map((m) => m.user_id)
    );
    const newEmployeeIds = employeesToAdd
      .filter((emp) => !existingMemberIds.has(emp.id))
      .map((emp) => emp.id);

    if (newEmployeeIds.length === 0) {
      return errorResponse(
        res,
        "All specified employees are already members of this ticket",
        400
      );
    }

    // Add new employees as members
    const members = newEmployeeIds.map((employeeId) => ({
      ticket_id: ticketId,
      user_id: employeeId,
      added_by: userId,
      can_message_client: false, // Default to false, admin can grant permission later
    }));

    const { error: membersError } = await supabaseAdmin
      .from("ticket_members")
      .insert(members);

    if (membersError) {
      console.error("Error adding employees to ticket:", membersError);
      return errorResponse(res, "Failed to add employees to ticket", 500);
    }

    // Create notifications for each new employee
    const notifications = newEmployeeIds.map((employeeId) => ({
      user_id: employeeId,
      type: "ticket_assigned",
      title: "Added to Ticket",
      message: `${user.name} added you to ticket "${ticket?.title || ticket?.ticket_number || "Untitled"
        }"`,
      related_ticket_id: ticketId,
      related_user_id: userId,
      is_read: false,
    }));

    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert(notifications);

    if (notificationError) {
      console.error("Error creating notifications:", notificationError);
      // Don't fail the request if notifications fail
    }

    // Get details of added employees for response
    const addedEmployees = employeesToAdd.filter((emp) =>
      newEmployeeIds.includes(emp.id)
    );

    console.log("✅ Successfully added employees to ticket:", {
      ticketId,
      addedBy: user.name,
      addedEmployees: addedEmployees.map((emp) => ({
        id: emp.id,
        name: emp.name,
      })),
    });

    return successResponse(
      res,
      {
        addedEmployees: addedEmployees.map((emp) => ({
          id: emp.id,
          name: emp.name,
          email: emp.email,
          role: emp.role,
        })),
        addedBy: {
          id: userId,
          name: user.name,
          role: user.role,
        },
      },
      `Successfully added ${newEmployeeIds.length} employee(s) to ticket`
    );
  } catch (error) {
    console.error("Add employees to ticket error:", error);
    return errorResponse(res, "Failed to add employees to ticket", 500);
  }
};

/**
 * Get available employees that can be added to a ticket
 * GET /api/tickets/:ticketId/available-employees
 */
export const getAvailableEmployees = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;

    // Get user details
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (!user) {
      return errorResponse(res, "User not found", 404);
    }

    // Check permissions: Admin can always view, employees must be members
    if (user.role !== "admin" && user.role !== "employee") {
      return errorResponse(
        res,
        "Only admin and employees can view available employees",
        403
      );
    }

    // If user is an employee, verify they are a member of this ticket
    if (user.role === "employee") {
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        return errorResponse(
          res,
          "You must be a member of this ticket to view available employees",
          403
        );
      }
    }

    // Get all approved employees and admins
    const { data: allEmployees, error: employeesError } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role, profile_picture, department")
      .in("role", ["employee", "admin"])
      .eq("approval_status", "approved")
      .order("name", { ascending: true });

    if (employeesError) {
      console.error("Error fetching employees:", employeesError);
      return errorResponse(res, "Failed to fetch employees", 500);
    }

    // Get current ticket members
    const { data: currentMembers } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id")
      .eq("ticket_id", ticketId);

    const currentMemberIds = new Set(
      (currentMembers || []).map((m) => m.user_id)
    );

    // Filter out employees who are already members
    const availableEmployees = (allEmployees || []).filter(
      (emp) => !currentMemberIds.has(emp.id)
    );

    return successResponse(
      res,
      {
        employees: availableEmployees.map((emp) => ({
          id: emp.id,
          name: emp.name,
          email: emp.email,
          role: emp.role,
          profilePicture: emp.profile_picture,
          department: emp.department,
        })),
        count: availableEmployees.length,
      },
      "Available employees fetched successfully"
    );
  } catch (error) {
    console.error("Get available employees error:", error);
    return errorResponse(res, "Failed to fetch available employees", 500);
  }
};

/**
 * Remove a member from a ticket
 * DELETE /api/tickets/:ticketId/members/:userId
 */
export const removeTicketMember = async (req, res) => {
  try {
    const { ticketId, userId } = req.params;
    const requesterId = req.user.id;

    // Get requester details
    const { data: requester } = await supabaseAdmin
      .from("users")
      .select("role, name")
      .eq("id", requesterId)
      .single();

    // Check permissions: Admin can remove anyone, employees can remove other employees if they are members
    if (requester.role !== "admin" && requester.role !== "employee") {
      return errorResponse(
        res,
        "Only admin and employees can remove members from tickets",
        403
      );
    }

    // If requester is an employee, verify they are a member of this ticket
    if (requester.role === "employee") {
      const { data: requesterMembership } = await supabaseAdmin
        .from("ticket_members")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("user_id", requesterId)
        .single();

      if (!requesterMembership) {
        return errorResponse(
          res,
          "You must be a member of this ticket to remove other members",
          403
        );
      }
    }

    // Get ticket details
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("id, ticket_number, title, created_by")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return errorResponse(res, "Ticket not found", 404);
    }

    // Prevent removing the ticket creator
    if (ticket.created_by === userId) {
      return errorResponse(res, "Cannot remove the ticket creator", 403);
    }

    // Get user details before removal
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("name, email, role")
      .eq("id", userId)
      .single();

    // Additional validation for employee requesters
    if (requester.role === "employee") {
      // Employees cannot remove admins
      if (user.role === "admin") {
        return errorResponse(
          res,
          "Employees cannot remove admin users from tickets",
          403
        );
      }

      // Employees cannot remove themselves (they should use a different endpoint or UI)
      if (userId === requesterId) {
        return errorResponse(
          res,
          "Use the leave ticket functionality to remove yourself",
          400
        );
      }

      // Employees can only remove other employees, freelancers, or clients
      const removableRoles = ["employee", "freelancer", "client"];
      if (!removableRoles.includes(user.role)) {
        return errorResponse(
          res,
          `Cannot remove users with role: ${user.role}`,
          403
        );
      }
    }

    // Check if user is a member
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("ticket_members")
      .select("id")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (membershipError || !membership) {
      return errorResponse(res, "User is not a member of this ticket", 404);
    }

    // Remove the member
    const { error: removeError } = await supabaseAdmin
      .from("ticket_members")
      .delete()
      .eq("ticket_id", ticketId)
      .eq("user_id", userId);

    if (removeError) {
      console.error("Error removing member:", removeError);
      return errorResponse(res, "Failed to remove member", 500);
    }

    // Create notification for the removed user
    await supabaseAdmin.from("notifications").insert([
      {
        user_id: userId,
        type: "ticket_update",
        title: "Removed from Ticket",
        message: `${requester.name} removed you from ticket "${ticket.title || ticket.ticket_number || "Untitled"
          }"`,
        related_ticket_id: ticketId,
        related_user_id: requesterId,
        is_read: false,
      },
    ]);

    console.log(
      `✅ User ${user?.name || userId} removed from ticket ${ticket.ticket_number
      }`
    );

    return successResponse(
      res,
      {
        ticketId,
        userId,
        userName: user?.name,
        userEmail: user?.email,
      },
      "Member removed successfully"
    );
  } catch (error) {
    console.error("Remove ticket member error:", error);
    return errorResponse(res, "Failed to remove member", 500);
  }
};

/**
 * Remove employee from ticket (Employee-specific endpoint)
 * DELETE /api/tickets/:ticketId/remove-employee/:userId
 */
export const removeEmployeeFromTicket = async (req, res) => {
  try {
    const { ticketId, userId } = req.params;
    const requesterId = req.user.id;

    console.log("🗑️ Employee removing another employee from ticket:", {
      ticketId,
      requesterId,
      targetUserId: userId,
    });

    // Get requester details
    const { data: requester } = await supabaseAdmin
      .from("users")
      .select("role, name, email")
      .eq("id", requesterId)
      .single();

    if (!requester) {
      return errorResponse(res, "Requester not found", 404);
    }

    // Check if requester is admin or employee
    if (requester.role !== "admin" && requester.role !== "employee") {
      return errorResponse(
        res,
        "Only admin and employees can remove employees from tickets",
        403
      );
    }

    // If requester is an employee, verify they are a member of this ticket
    if (requester.role === "employee") {
      const { data: requesterMembership } = await supabaseAdmin
        .from("ticket_members")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("user_id", requesterId)
        .single();

      if (!requesterMembership) {
        return errorResponse(
          res,
          "You must be a member of this ticket to remove other employees",
          403
        );
      }
    }

    // Get ticket details
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("ticket_number, title, created_by")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      return errorResponse(res, "Ticket not found", 404);
    }

    // Prevent removing the ticket creator
    if (ticket.created_by === userId) {
      return errorResponse(res, "Cannot remove the ticket creator", 403);
    }

    // Prevent employees from removing themselves (should use leave functionality)
    if (userId === requesterId) {
      return errorResponse(
        res,
        "Use the leave ticket functionality to remove yourself",
        400
      );
    }

    // Get target user details
    const { data: targetUser, error: targetUserError } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role, profile_picture")
      .eq("id", userId)
      .single();

    if (targetUserError || !targetUser) {
      return errorResponse(res, "Target user not found", 404);
    }

    // Validate target user role - employees can only remove other employees, freelancers, or clients
    if (requester.role === "employee") {
      if (targetUser.role === "admin") {
        return errorResponse(
          res,
          "Employees cannot remove admin users from tickets",
          403
        );
      }

      const removableRoles = ["employee", "freelancer", "client"];
      if (!removableRoles.includes(targetUser.role)) {
        return errorResponse(
          res,
          `Cannot remove users with role: ${targetUser.role}`,
          403
        );
      }
    }

    // Check if target user is a member
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("ticket_members")
      .select("id, added_at")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (membershipError || !membership) {
      return errorResponse(res, "User is not a member of this ticket", 404);
    }

    // Remove the member
    const { error: removeError } = await supabaseAdmin
      .from("ticket_members")
      .delete()
      .eq("ticket_id", ticketId)
      .eq("user_id", userId);

    if (removeError) {
      console.error("Error removing employee from ticket:", removeError);
      return errorResponse(res, "Failed to remove employee from ticket", 500);
    }

    // Create notification for the removed user
    const { error: notificationError } = await supabaseAdmin
      .from("notifications")
      .insert([
        {
          user_id: userId,
          type: "ticket_update",
          title: "Removed from Ticket",
          message: `${requester.name} removed you from ticket "${ticket?.title || ticket?.ticket_number || "Untitled"
            }"`,
          related_ticket_id: ticketId,
          related_user_id: requesterId,
          is_read: false,
        },
      ]);

    if (notificationError) {
      console.error("Error creating removal notification:", notificationError);
      // Don't fail the request if notification fails
    }

    console.log("✅ Successfully removed employee from ticket:", {
      ticketId,
      removedBy: requester.name,
      removedUser: targetUser.name,
      removedUserRole: targetUser.role,
    });

    return successResponse(
      res,
      {
        ticketId,
        removedUser: {
          id: targetUser.id,
          name: targetUser.name,
          email: targetUser.email,
          role: targetUser.role,
        },
        removedBy: {
          id: requesterId,
          name: requester.name,
          role: requester.role,
        },
      },
      `Successfully removed ${targetUser.role} from ticket`
    );
  } catch (error) {
    console.error("Remove employee from ticket error:", error);
    return errorResponse(res, "Failed to remove employee from ticket", 500);
  }
};

/**
 * Update employee permission to message client
 * PUT /api/tickets/:ticketId/members/:memberId/client-permission
 */
export const updateMemberClientPermission = async (req, res) => {
  try {
    const { ticketId, memberId } = req.params;
    const { canMessageClient } = req.body;
    const userId = req.user.id;

    if (canMessageClient === undefined) {
      return validationError(res, { field: "canMessageClient is required" });
    }

    // Get admin user
    const { data: admin } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    // Only admin can update permissions
    if (admin.role !== "admin") {
      return errorResponse(
        res,
        "Only admin can update member permissions",
        403
      );
    }

    // Get the member user to verify they're an employee
    const { data: memberUser } = await supabaseAdmin
      .from("users")
      .select("role, name")
      .eq("id", memberId)
      .single();

    if (!memberUser) {
      return errorResponse(res, "User not found", 404);
    }

    // Only employees need this permission (admins and freelancers always have it)
    if (memberUser.role !== "employee") {
      return errorResponse(
        res,
        "Client messaging permission only applies to employees",
        400
      );
    }

    // Update the permission
    const { error: updateError } = await supabaseAdmin
      .from("ticket_members")
      .update({ can_message_client: canMessageClient })
      .eq("ticket_id", ticketId)
      .eq("user_id", memberId);

    if (updateError) {
      console.error("Error updating member permission:", updateError);
      return errorResponse(res, "Failed to update permission", 500);
    }

    return successResponse(
      res,
      { canMessageClient },
      `${memberUser.name || "Employee"} ${canMessageClient ? "can now" : "can no longer"
      } message the client`
    );
  } catch (error) {
    console.error("Update member permission error:", error);
    return errorResponse(res, "Failed to update permission", 500);
  }
};

/**
 * Update ticket
 * PUT /api/tickets/:ticketId
 */
export const updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const updates = req.body;
    const userId = req.user.id;

    // Get user role
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    // Admins can update any ticket
    if (user.role === "admin") {
      // Admin can proceed - no additional checks needed
    } else if (user.role === "employee") {
      // Employees can only update tickets they are members of
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("id")
        .eq("ticket_id", ticketId)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        return errorResponse(
          res,
          "You must be a member of this ticket to update it",
          403
        );
      }
    } else {
      // Freelancers, clients, and other roles cannot update tickets
      return errorResponse(
        res,
        "Only admins and employee members can update tickets",
        403
      );
    }

    // Whitelist allowed fields to prevent overwriting sensitive data (like id, created_by, etc.)
    const allowedFields = ["title", "description", "priority", "status", "points"];
    const filteredUpdates = {};

    // Only allow updates to fields that are present in the request and allowed
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key) && updates[key] !== undefined) {
        filteredUpdates[key] = updates[key];
      }
    });

    if (Object.keys(filteredUpdates).length === 0) {
      return errorResponse(res, "No valid fields to update", 400);
    }

    // Explicitly handle updated_at
    filteredUpdates.updated_at = new Date().toISOString();

    const { data: ticket, error: updateError } = await supabaseAdmin
      .from("tickets")
      .update(filteredUpdates)
      .eq("id", ticketId)
      .select("*, created_by_user:users!created_by(id, name, email, phone, role)")
      .single();

    if (updateError) {
      console.error("Error updating ticket:", updateError);
      return errorResponse(res, "Failed to update ticket", 500);
    }

    // --- WHATSAPP NOTIFICATION LOGIC ---
    // If status is updated to "Pending with client", trigger WhatsApp notification
    if (filteredUpdates.status === "Pending with client" && ticket.created_by_user) {
      const creator = ticket.created_by_user;

      console.log("📱 [UpdateTicket] Checking WhatsApp conditions:", {
        status: filteredUpdates.status,
        creatorRole: creator.role,
        hasPhone: !!creator.phone,
        creatorPhone: creator.phone?.replace(/\d(?=\d{4})/g, "*"),
      });

      // Only send WhatsApp to clients with phone numbers
      if (creator.role === "client" && creator.phone) {
        console.log("📱 Sending WhatsApp message for ticket status update...");

        // Run asynchronously (fire and forget)
        sendTicketStatusWhatsApp(
          creator.phone,
          {
            ticketNumber: ticket.ticket_number,
            title: ticket.title,
            uid: ticket.uid,
          },
          filteredUpdates.status
        )
          .then(async (whatsappResult) => {
            if (whatsappResult.success) {
              console.log("✅ WhatsApp message sent successfully to client");
              await supabaseAdmin.from("notifications").insert({
                user_id: creator.id,
                type: "whatsapp_sent",
                title: "WhatsApp Message Sent",
                message: `WhatsApp notification sent for ticket status: ${filteredUpdates.status}`,
                related_id: ticket.id,
                is_read: true,
              });
            } else {
              console.error("❌ WhatsApp message failed:", whatsappResult.error);
              await supabaseAdmin.from("notifications").insert({
                user_id: creator.id,
                type: "whatsapp_failed",
                title: "WhatsApp Message Failed",
                message: `Failed to send WhatsApp notification: ${whatsappResult.error}`,
                related_id: ticket.id,
                is_read: true,
              });
            }
          })
          .catch(err => console.error("❌ WhatsApp background error:", err));
      }
    }
    // -----------------------------------

    return successResponse(res, { ticket }, "Ticket updated successfully");
  } catch (error) {
    console.error("Update ticket error:", error);
    return errorResponse(res, "Failed to update ticket", 500);
  }
};

/**
 * Delete ticket (Admin only)
 * DELETE /api/tickets/:ticketId
 */
export const deleteTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log("🗑️ Delete ticket attempt:", {
      ticketId,
      userId,
      userEmail: req.user.email,
      userRole,
      isAdmin: userRole === "admin",
    });

    // Only admin can delete tickets
    if (userRole !== "admin") {
      console.log("❌ Delete ticket denied: User is not admin");
      return errorResponse(res, "Only admin can delete tickets", 403);
    }

    // Step 1: Get ticket details before deletion
    console.log("� Fetching ticket details before deletion...");
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("id, ticket_number, title")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      console.error("❌ Ticket not found:", ticketError);
      return errorResponse(res, "Ticket not found", 404);
    }

    // Step 2: Get all files associated with the ticket (for storage deletion)
    console.log("📁 Fetching associated files...");
    const { data: ticketFiles } = await supabaseAdmin
      .from("ticket_files")
      .select("file_url, file_name")
      .eq("ticket_id", ticketId);

    // Step 3: Get all messages with file attachments
    const { data: messageFiles } = await supabaseAdmin
      .from("ticket_messages")
      .select("file_url, file_name")
      .eq("ticket_id", ticketId)
      .not("file_url", "is", null);

    // Step 4: Get all ticket members (to notify them via socket)
    const { data: members } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id")
      .eq("ticket_id", ticketId);

    console.log("📊 Deletion summary:", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      filesCount: (ticketFiles?.length || 0) + (messageFiles?.length || 0),
      membersCount: members?.length || 0,
    });

    // Step 5: Delete files from Supabase Storage
    const allFiles = [...(ticketFiles || []), ...(messageFiles || [])];
    if (allFiles.length > 0) {
      console.log(`🗑️ Deleting ${allFiles.length} files from storage...`);

      for (const file of allFiles) {
        if (file.file_url) {
          try {
            // Extract file path from URL
            // URL format: https://{project}.supabase.co/storage/v1/object/public/tickets/{path}
            const urlParts = file.file_url.split("/tickets/");
            if (urlParts.length > 1) {
              const filePath = urlParts[1];
              const { error: storageError } = await supabaseAdmin.storage
                .from("tickets")
                .remove([filePath]);

              if (storageError) {
                console.warn(
                  "⚠️ Failed to delete file from storage:",
                  filePath,
                  storageError
                );
              } else {
                console.log("✅ Deleted file from storage:", filePath);
              }
            }
          } catch (fileError) {
            console.warn("⚠️ Error deleting file:", file.file_name, fileError);
          }
        }
      }
    }

    // Step 6: Delete ticket from database
    // This will cascade delete:
    // - ticket_members (ON DELETE CASCADE)
    // - ticket_messages (ON DELETE CASCADE)
    // - ticket_files (ON DELETE CASCADE)
    // - starred_tickets (ON DELETE CASCADE)
    console.log("🔄 Deleting ticket from database (cascade delete enabled)...");

    const { error: deleteError } = await supabaseAdmin
      .from("tickets")
      .delete()
      .eq("id", ticketId);

    if (deleteError) {
      console.error("❌ Error deleting ticket:", deleteError);
      return errorResponse(res, "Failed to delete ticket", 500);
    }

    console.log("✅ Ticket deleted successfully from database");

    // Step 7: Emit socket event to notify all ticket members
    if (members && members.length > 0) {
      console.log(`📡 Notifying ${members.length} members via socket...`);

      const io = req.app.get("io");
      if (io) {
        // Emit to the ticket room
        io.to(`ticket:${ticketId}`).emit("ticket_deleted", {
          ticketId: ticket.id,
          ticketNumber: ticket.ticket_number,
          ticketTitle: ticket.title,
          deletedBy: {
            id: userId,
            email: req.user.email,
            name: req.user.name,
          },
          deletedAt: new Date().toISOString(),
        });

        // Also emit to each member's personal room
        members.forEach((member) => {
          io.to(`user:${member.user_id}`).emit("ticket_deleted", {
            ticketId: ticket.id,
            ticketNumber: ticket.ticket_number,
            ticketTitle: ticket.title,
            deletedBy: {
              id: userId,
              email: req.user.email,
              name: req.user.name,
            },
            deletedAt: new Date().toISOString(),
          });
        });

        console.log("✅ Socket notifications sent");
      }
    }

    console.log("✅ Ticket deletion completed successfully:", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
    });

    return successResponse(
      res,
      {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        deletedMembers: members?.length || 0,
        deletedFiles: allFiles.length,
      },
      "Ticket and all related data deleted successfully"
    );
  } catch (error) {
    console.error("❌ Delete ticket error:", error);
    return errorResponse(res, "Failed to delete ticket", 500);
  }
};

/**
 * Get messages for a ticket
 * GET /api/tickets/:ticketId/messages
 */
export const getTicketMessages = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { limit = 50, before } = req.query;
    const userId = req.user.id;

    // Use req.user.role from JWT token (already set by authenticateToken middleware)
    const userRole = req.user.role;
    const userEmail = req.user.email;

    console.log("📨 Get messages request:", {
      ticketId,
      userId,
      userEmail,
      userRole,
      limit,
      before,
    });

    // Check if user is a member and get their join date
    const { data: membership } = await supabaseAdmin
      .from("ticket_members")
      .select("*, tickets!inner(created_by)")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    console.log("👥 Membership check:", {
      isMember: !!membership,
      addedAt: membership?.added_at,
      createdBy: membership?.tickets?.created_by,
      isCreator: membership?.tickets?.created_by === userId,
    });

    // Allow admins and employees to fetch messages for any ticket
    if (!membership && userRole !== "admin" && userRole !== "employee") {
      console.log("❌ Access denied: Not a member and not admin/employee");
      return errorResponse(res, "You do not have access to this ticket", 403);
    }

    const isAdmin = userRole === "admin";
    const isEmployee = userRole === "employee";
    const isCreator =
      membership && membership.tickets
        ? membership.tickets.created_by === userId
        : false;

    console.log("🔐 Access level:", {
      isAdmin,
      isEmployee,
      isCreator,
      shouldFilterMessages: !isAdmin && !isCreator && membership?.added_at,
    });

    // Build query - fetch messages with sender and reply details using joins
    // This replaces the N+1 pattern where we fetched sender details for each message
    // OPTIMIZED QUERY STRATEGY: BATCH FETCHING for Messages
    // 1. Fetch messages
    // 2. Collect sender IDs and Reply IDs
    // 3. Batch fetch users and reply messages
    // 4. Map back

    let query = supabaseAdmin
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: false })
      .limit(parseInt(limit));

    // ===== NEW MESSAGE FILTERING LOGIC =====
    // Remove timestamp filtering - all users see historical messages
    // Instead, filter by message_mode based on role:
    // - ADMINS: See ALL messages (no filter)
    // - EMPLOYEES: See ALL messages (no filter) - they need full context
    // - FREELANCERS: See ALL messages (no filter) - they need full context
    // - TICKET CREATORS (any role): See ALL messages based on their role
    // - CLIENTS (non-creators): Only see CLIENT-MODE messages (all time)

    const isClient = userRole === 'client';

    // Clients who are NOT creators only see client-mode messages
    if (isClient && !isCreator) {
      console.log(
        '🔍 FILTERING BY MESSAGE MODE: Client (non-creator) - only client messages (all time)'
      );
      query = query.eq('message_mode', 'client');
    } else {
      console.log(
        '✅ NO MESSAGE MODE FILTERING: Showing ALL messages (all time)',
        {
          isAdmin,
          isEmployee,
          isFreelancer: userRole === 'freelancer',
          isCreator,
          reason: isAdmin
            ? 'USER IS ADMIN'
            : isEmployee
              ? 'USER IS EMPLOYEE'
              : userRole === 'freelancer'
                ? 'USER IS FREELANCER'
                : isCreator
                  ? 'USER IS CREATOR'
                  : 'UNKNOWN',
        }
      );
    }

    // Add pagination
    if (before) {
      query = query.lt("created_at", before);
    }

    // --- PERFORMANCE LOG ---
    console.time("FetchMessagesQuery");
    const { data: messages, error } = await query;
    console.timeEnd("FetchMessagesQuery");

    if (error) {
      console.error("❌ Error fetching messages:", error);
      return errorResponse(res, "Failed to fetch messages", 500);
    }

    console.log("📊 Messages fetched:", {
      count: messages?.length || 0,
      isAdmin,
      isCreator,
      wasFiltered: !isAdmin && !isCreator && membership?.added_at,
      firstMessageDate: messages?.[messages.length - 1]?.created_at,
      lastMessageDate: messages?.[0]?.created_at,
      memberJoinDate: membership?.added_at,
    });

    // Log first few message IDs for debugging
    if (messages && messages.length > 0) {
      console.log(
        "📝 Sample messages:",
        messages.slice(0, 3).map((m) => ({
          id: m.id.substring(0, 8),
          created_at: m.created_at,
          message_preview: m.message?.substring(0, 30),
        }))
      );
    }

    if (!messages || messages.length === 0) {
      // Return empty list immediately if no messages
      return successResponse(res, { messages: [] }, "No messages found");
    }

    // --- BATCH FETCH DATA (AGGRESSIVE PARALLEL) ---
    const senderIds = messages.map(m => m.sender_id).filter(Boolean);
    const replyMessageIds = messages.map(m => m.reply_to_message_id).filter(Boolean);

    const uniqueSenderIds = [...new Set(senderIds)];
    const uniqueReplyIds = [...new Set(replyMessageIds)];

    let usersMap = new Map();
    let repliesMap = new Map();

    // Parallel processing for Senders and Replies 🚀
    // Parallel processing for Senders and Replies 🚀
    console.time("BatchFetch");
    const [usersResult, repliesResult] = await Promise.all([
      // A. Fetch Senders
      uniqueSenderIds.length > 0
        ? supabaseAdmin
          .from("users")
          .select("id, email, name, profile_picture, role")
          .in("id", uniqueSenderIds)
        : { data: [] },
      // B. Fetch Replies
      uniqueReplyIds.length > 0
        ? supabaseAdmin
          .from("ticket_messages")
          .select("id, message, message_type, sender_id, created_at, is_deleted")
          .in("id", uniqueReplyIds)
        : { data: [] }
    ]);
    console.timeEnd("BatchFetch");

    // Process Users
    if (usersResult.data) {
      usersResult.data.forEach(u => usersMap.set(u.id, u));
    }

    // Process Replies & Missing Senders
    if (repliesResult.data) {
      const replies = repliesResult.data;
      replies.forEach(r => repliesMap.set(r.id, r));

      // Also need to know senders of replies if not already fetched
      const replySenderIds = replies.map(r => r.sender_id).filter(Boolean);
      const missingSenderIds = replySenderIds.filter(id => !usersMap.has(id));

      if (missingSenderIds.length > 0) {
        const { data: replySenders } = await supabaseAdmin
          .from("users")
          .select("id, name")
          .in("id", [...new Set(missingSenderIds)]);

        if (replySenders) {
          replySenders.forEach(u => usersMap.set(u.id, u));
        }
      }
    }

    // Transform messages to match frontend structure
    const messagesWithSender = await Promise.all(
      (messages || []).map(async (message) => {
        // 1. Format sender (from map)
        const userData = usersMap.get(message.sender_id) || {
          id: message.sender_id,
          name: "Unknown User",
          email: "",
          profile_picture: null,
          role: "unknown"
        };

        // 2. Format reply (from map)
        let replyToMessage = null;
        if (message.reply_to_message_id) {
          const reply = repliesMap.get(message.reply_to_message_id);
          if (reply) {
            const replySender = usersMap.get(reply.sender_id) || { name: 'Unknown' };

            replyToMessage = {
              id: reply.id,
              sender_id: reply.sender_id,
              sender_name: replySender.name,
              message: reply.is_deleted ? "Message deleted" : (reply.message_type === 'text' ? reply.message : (reply.message_type === 'image' ? 'Image' : 'File')),
              message_type: reply.message_type,
              created_at: reply.created_at
            };
          }
        }

        // 3. Forwarded messages (Keep existing logic for now as it's complex to join deeply)
        let forwardedFrom = null;
        if (
          message.forwarded_from_message_id &&
          message.forwarded_from_ticket_id
        ) {
          // Keep existing manual fetch for forwarded messages for safety
          // (Can be optimized later if needed)
          const { data: sourceTicket } = await supabaseAdmin
            .from("tickets")
            .select("id, ticket_number, title")
            .eq("id", message.forwarded_from_ticket_id)
            .single();

          const { data: originalMessage } = await supabaseAdmin
            .from("ticket_messages")
            .select("id, sender_id, sender:users!ticket_messages_sender_id_fkey(id, name, email, role)")
            .eq("id", message.forwarded_from_message_id)
            .single();

          if (sourceTicket && originalMessage) {
            forwardedFrom = {
              ticketId: sourceTicket.id,
              ticketNumber: sourceTicket.ticket_number,
              ticketTitle: sourceTicket.title,
              originalSender: originalMessage.sender,
            };
          }
        }

        // 4. Seen By (Keep existing logic)
        let seenBy = [];
        const { data: seenRecords, error: seenError } = await supabaseAdmin
          .from('message_seen_by')
          .select('user_id, seen_at, users!message_seen_by_user_id_fkey(id, name, email, role, profile_picture)')
          .eq('message_id', message.id);

        if (!seenError && seenRecords) {
          seenBy = seenRecords.map(record => ({
            userId: record.user_id,
            userName: record.users?.name || 'Unknown',
            userRole: record.users?.role,
            profilePicture: record.users?.profile_picture,
            seenAt: record.seen_at
          }));
        }

        return {
          ...message,
          sender: userData,
          user: userData,
          reply_to: replyToMessage,
          forwarded_from: forwardedFrom,
          forwardedFrom: forwardedFrom,
          isForwarded: !!forwardedFrom,
          seen_by: seenBy
        };
      })
    );

    return successResponse(
      res,
      { messages: messagesWithSender },
      "Messages fetched successfully"
    );
  } catch (error) {
    console.error("Get ticket messages error:", error);
    return errorResponse(res, "Failed to fetch messages", 500);
  }
};

/**
 * Add message to ticket (HTTP endpoint - mainly for file uploads)
 * POST /api/tickets/:ticketId/messages
 */
export const addTicketMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message, messageType, fileUrl } = req.body;
    const userId = req.user.id;

    if (!message) {
      return validationError(res, { field: "Message is required" });
    }

    // Check if user is a member
    const { data: membership } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return errorResponse(res, "You do not have access to this ticket", 403);
    }

    const { data: newMessage, error: messageError } = await supabaseAdmin
      .from("ticket_messages")
      .insert([
        {
          ticket_id: ticketId,
          sender_id: userId,
          message,
          message_type: messageType || "text",
          file_url: fileUrl || null,
        },
      ])
      .select(`
        *,
        sender:users!sender_id (id, email, name, profile_picture)
      `)
      .single();

    if (messageError) {
      console.error("Error adding message:", messageError);
      return errorResponse(res, "Failed to add message", 500);
    }

    // Sender details are already in the response thanks to the join
    const messageWithSender = newMessage;

    return successResponse(
      res,
      { message: messageWithSender },
      "Message added successfully"
    );
  } catch (error) {
    console.error("Add ticket message error:", error);
    return errorResponse(res, "Failed to add message", 500);
  }
};

/**
 * Update ticket works/points
 * PUT /api/tickets/:id/points
 */
export const updateTicketPoints = async (req, res) => {
  try {
    const { id } = req.params;
    const { points } = req.body;
    const userId = req.user.id;

    // Get user role
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    // Admins can update any ticket
    if (user.role === "admin") {
      // Admin can proceed - no additional checks needed
    } else if (user.role === "employee") {
      // Employees can only update tickets they are members of
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("id")
        .eq("ticket_id", id)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        return errorResponse(
          res,
          "You must be a member of this ticket to update works to do",
          403
        );
      }
    } else {
      // Freelancers, clients, and other roles cannot update works to do
      return errorResponse(
        res,
        "Only admins and employee members can update works to do",
        403
      );
    }

    // Update ticket points
    const { data: ticket, error: updateError } = await supabaseAdmin
      .from("tickets")
      .update({ points })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating ticket points:", updateError);
      return errorResponse(res, "Failed to update works to do", 500);
    }

    // Get all members of this ticket (except admin)
    const { data: members } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id, users!inner(role)")
      .eq("ticket_id", id);

    // Filter out admin users
    const nonAdminMembers =
      members?.filter((m) => m.users.role !== "admin") || [];

    // Create notifications for all non-admin members
    for (const member of nonAdminMembers) {
      await supabaseAdmin.from("notifications").insert({
        user_id: member.user_id,
        type: "works_updated",
        title: "Works to do updated",
        message: `The works to do list has been updated for ticket "${ticket.title}"`,
        related_id: ticket.id,
        is_read: false,
      });
    }

    return successResponse(
      res,
      { ticket, memberIds: nonAdminMembers.map((m) => m.user_id) },
      "Works to do updated successfully"
    );
  } catch (error) {
    console.error("Update ticket points error:", error);
    return errorResponse(res, "Failed to update works to do", 500);
  }
};

/**
 * Update ticket status
 * PUT /api/tickets/:id/status
 */
export const updateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Check if user is admin, employee, or freelancer member
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role, name")
      .eq("id", userId)
      .single();

    // If user is admin, allow immediately
    if (user.role === "admin") {
      console.log("✅ Admin user - status update authorized");
    }
    // If user is employee or freelancer, check if they are a member of this ticket
    else if (user.role === "employee" || user.role === "freelancer") {
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("id")
        .eq("ticket_id", id)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        console.log(`❌ ${user.role} is not a member of this ticket`);
        return errorResponse(
          res,
          "Only admins or ticket members (employees/freelancers) can update ticket status",
          403
        );
      }
      console.log(`✅ ${user.role} member - status update authorized`);
    }
    // All other roles are not allowed
    else {
      console.log("❌ User role not authorized:", user.role);
      return errorResponse(
        res,
        "Only admins or ticket members (employees/freelancers) can update ticket status",
        403
      );
    }

    // Validate status - map to database values
    const validStatuses = [
      "Created",
      "Assigned",
      "Ongoing",
      "Pending with reviewer",
      "Pending with client",
      "Completed",
      "Closed",
    ];
    if (!validStatuses.includes(status)) {
      return validationError(res, {
        field: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    // Get current ticket details before update
    const { data: currentTicket } = await supabaseAdmin
      .from("tickets")
      .select(
        "*, created_by_user:users!created_by(id, name, email, phone, role)"
      )
      .eq("id", id)
      .single();

    if (!currentTicket) {
      return errorResponse(res, "Ticket not found", 404);
    }

    // Update ticket status
    const { data: ticket, error: updateError } = await supabaseAdmin
      .from("tickets")
      .update({ status: status })
      .eq("id", id)
      .select(
        "*, created_by_user:users!created_by(id, name, email, phone, role)"
      )
      .single();

    if (updateError) {
      console.error("Error updating ticket status:", updateError);
      return errorResponse(res, "Failed to update ticket status", 500);
    }

    // Get all members of this ticket (except admin)
    const { data: members } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id, users!inner(role)")
      .eq("ticket_id", id);

    // Filter out admin users
    const nonAdminMembers =
      members?.filter((m) => m.users.role !== "admin") || [];

    // Create notifications for all non-admin members (excluding the user who made the change)
    const changerName = user.name || "Someone";
    for (const member of nonAdminMembers) {
      // Skip the user who made the change
      if (member.user_id === userId) continue;

      await supabaseAdmin.from("notifications").insert({
        user_id: member.user_id,
        type: "status_updated",
        title: "Ticket status updated",
        message: `Status changed to "${status}" by ${changerName} for "${ticket.title}"`,
        related_id: ticket.id,
        is_read: false,
      });
    }

    // Send WhatsApp message if status is "Pending with client" and ticket creator is a client
    if (status === "Pending with client" && ticket.created_by_user) {
      const creator = ticket.created_by_user;

      console.log("📱 Checking WhatsApp conditions:", {
        status,
        creatorRole: creator.role,
        hasPhone: !!creator.phone,
        creatorPhone: creator.phone?.replace(/\d(?=\d{4})/g, "*"), // Mask for logging
      });

      // Only send WhatsApp to clients with phone numbers
      if (creator.role === "client" && creator.phone) {
        console.log("📱 Sending WhatsApp message for ticket status update...");

        try {
          const whatsappResult = await sendTicketStatusWhatsApp(
            creator.phone,
            {
              ticketNumber: ticket.ticket_number,
              title: ticket.title,
              uid: ticket.uid,
            },
            status
          );

          if (whatsappResult.success) {
            console.log("✅ WhatsApp message sent successfully to client");

            // Log WhatsApp message in database for audit trail
            await supabaseAdmin.from("notifications").insert({
              user_id: creator.id,
              type: "whatsapp_sent",
              title: "WhatsApp Message Sent",
              message: `WhatsApp notification sent for ticket status: ${status}`,
              related_id: ticket.id,
              is_read: true, // Mark as read since it's just a log
            });
          } else {
            console.error("❌ WhatsApp message failed:", whatsappResult.error);

            // Log failed WhatsApp attempt
            await supabaseAdmin.from("notifications").insert({
              user_id: creator.id,
              type: "whatsapp_failed",
              title: "WhatsApp Message Failed",
              message: `Failed to send WhatsApp notification: ${whatsappResult.error}`,
              related_id: ticket.id,
              is_read: true,
            });
          }
        } catch (whatsappError) {
          console.error("❌ WhatsApp service error:", whatsappError);
        }
      } else {
        console.log("📱 WhatsApp not sent:", {
          reason:
            creator.role !== "client"
              ? "Creator is not a client"
              : "No phone number available",
          creatorRole: creator.role,
          hasPhone: !!creator.phone,
        });
      }
    }

    // Emit socket event for real-time updates
    if (req.app.get("io")) {
      req.app
        .get("io")
        .to(`ticket:${id}`)
        .emit("ticket_updated", {
          id: ticket.id,
          status: ticket.status,
          updatedBy: user.name || "Admin",
        });
    }

    return successResponse(
      res,
      { ticket },
      "Ticket status updated successfully"
    );
  } catch (error) {
    console.error("Update ticket status error:", error);
    return errorResponse(res, "Failed to update ticket status", 500);
  }
};

/**
 * Update ticket priority
 * PUT /api/tickets/:id/priority
 */
export const updateTicketPriority = async (req, res) => {
  try {
    const { id } = req.params;
    const { priority } = req.body;
    const userId = req.user.id;

    // Check if user is admin
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (user.role !== "admin") {
      return errorResponse(res, "Only admins can update ticket priority", 403);
    }

    // Validate priority - should be in P1, P2, P3, P4, P5 format
    const validPriorities = ["P1", "P2", "P3", "P4", "P5"];
    if (!validPriorities.includes(String(priority))) {
      return validationError(res, {
        field: "Invalid priority. Must be P1, P2, P3, P4, or P5",
      });
    }

    // Update ticket priority
    const { data: ticket, error: updateError } = await supabaseAdmin
      .from("tickets")
      .update({ priority: String(priority) })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating ticket priority:", updateError);
      return errorResponse(res, "Failed to update ticket priority", 500);
    }

    // Get all members of this ticket (except admin)
    const { data: members } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id, users!inner(role)")
      .eq("ticket_id", id);

    // Filter out admin users
    const nonAdminMembers =
      members?.filter((m) => m.users.role !== "admin") || [];

    // Create notifications for all non-admin members
    for (const member of nonAdminMembers) {
      await supabaseAdmin.from("notifications").insert({
        user_id: member.user_id,
        type: "priority_updated",
        title: "Ticket priority updated",
        message: `Ticket priority has been updated to "Priority ${priority}" for "${ticket.title}"`,
        related_id: ticket.id,
        is_read: false,
      });
    }

    // Emit socket event for real-time updates
    if (req.app.get("io")) {
      req.app
        .get("io")
        .to(`ticket:${id}`)
        .emit("ticket_updated", {
          id: ticket.id,
          priority: ticket.priority,
          updatedBy: user.name || "Admin",
        });
    }

    return successResponse(
      res,
      { ticket },
      "Ticket priority updated successfully"
    );
  } catch (error) {
    console.error("Update ticket priority error:", error);
    return errorResponse(res, "Failed to update ticket priority", 500);
  }
};

/**
 * Generate signed URL for direct upload to Supabase Storage
 * POST /api/tickets/:ticketId/upload-url
 *
 * This endpoint generates a pre-signed URL that the frontend can use to upload
 * files directly to Supabase Storage, bypassing Vercel's 4.5MB body limit.
 */
export const generateUploadUrl = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { fileName, fileSize, mimeType } = req.body;
    const userId = req.user.id;

    console.log("🔗 Generating upload URL:", {
      ticketId,
      fileName,
      fileSize,
      mimeType,
      userId,
    });

    // Validation
    if (!fileName) {
      return validationError(res, { field: "fileName is required" });
    }

    if (!fileSize || fileSize <= 0) {
      return validationError(res, { field: "Valid fileSize is required" });
    }

    // Check file size limit (50MB)
    const maxSize = 50 * 1024 * 1024;
    if (fileSize > maxSize) {
      return errorResponse(
        res,
        `File size exceeds 50MB limit. Your file: ${(
          fileSize /
          1024 /
          1024
        ).toFixed(2)}MB`,
        413
      );
    }

    // Check if user is a member of the ticket
    const { data: membership } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return errorResponse(res, "You do not have access to this ticket", 403);
    }

    // Generate unique file path
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const fileExt = path.extname(fileName);
    const sanitizedName = path
      .basename(fileName, fileExt)
      .replace(/[^a-zA-Z0-9-_]/g, "_");
    const uniqueFileName = `${sanitizedName}-${uniqueSuffix}${fileExt}`;
    const filePath = `ticket-files/${ticketId}/${uniqueFileName}`;

    console.log("📁 Generated file path:", filePath);

    // Create a signed URL for uploading (expires in 5 minutes)
    const { data: signedUrlData, error: urlError } = await supabaseAdmin.storage
      .from("user-uploads")
      .createSignedUploadUrl(filePath);

    if (urlError) {
      console.error("❌ Error generating signed URL:", urlError);
      return errorResponse(
        res,
        `Failed to generate upload URL: ${urlError.message}`,
        500
      );
    }

    // Get the public URL that will be used after upload
    const { data: publicUrlData } = supabaseAdmin.storage
      .from("user-uploads")
      .getPublicUrl(filePath);

    console.log("✅ Upload URL generated successfully");

    return successResponse(
      res,
      {
        uploadUrl: signedUrlData.signedUrl,
        token: signedUrlData.token,
        filePath: filePath,
        publicUrl: publicUrlData.publicUrl,
        fileName: uniqueFileName,
        originalFileName: fileName,
        expiresIn: 300, // 5 minutes in seconds
      },
      "Upload URL generated successfully"
    );
  } catch (error) {
    console.error("❌ Error generating upload URL:", error);
    return errorResponse(
      res,
      `Failed to generate upload URL: ${error.message}`,
      500
    );
  }
};

/**
 * Confirm file upload and create database record
 * POST /api/tickets/:ticketId/upload-confirm
 *
 * Called by frontend after successfully uploading to the signed URL
 */
export const confirmUpload = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { filePath, fileName, fileSize, mimeType } = req.body;
    const userId = req.user.id;

    console.log("✅ Confirming upload request received:");
    console.log("   - ticketId:", ticketId);
    console.log("   - userId:", userId);
    console.log("   - Request body:", JSON.stringify(req.body, null, 2));
    console.log("   - filePath:", filePath);
    console.log("   - fileName:", fileName);
    console.log("   - fileSize:", fileSize);
    console.log("   - mimeType:", mimeType);

    // Validation
    if (!filePath || !fileName) {
      console.error("❌ Validation failed - missing required fields");
      console.error("   - filePath present:", !!filePath);
      console.error("   - fileName present:", !!fileName);
      return validationError(res, {
        field: "filePath and fileName are required",
        received: { filePath, fileName, fileSize, mimeType },
      });
    }

    // Handle both full URL and storage path
    let storageFilePath = filePath;

    // If filePath is a full URL, extract just the storage path
    if (
      filePath.includes("supabase.co/storage/v1/object/public/user-uploads/")
    ) {
      const parts = filePath.split("/user-uploads/");
      storageFilePath = parts[1];
      console.log("📝 Extracted storage path from URL:", storageFilePath);
    } else if (filePath.startsWith("http")) {
      // Try to extract path from any URL format
      try {
        const url = new URL(filePath);
        const pathParts = url.pathname.split("/user-uploads/");
        if (pathParts.length > 1) {
          storageFilePath = pathParts[1];
          console.log("📝 Extracted storage path from URL:", storageFilePath);
        }
      } catch (err) {
        console.error("❌ Invalid URL format:", err);
      }
    }

    console.log("📁 Final storage path to check:", storageFilePath);

    // Check if user is a member
    const { data: membership } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return errorResponse(res, "You do not have access to this ticket", 403);
    }

    // Verify file exists in storage using the storage path
    const dirPath = path.dirname(storageFilePath);
    const baseName = path.basename(storageFilePath);

    console.log("🔍 Checking file existence:");
    console.log("   - Directory:", dirPath);
    console.log("   - Filename:", baseName);

    const { data: fileExists, error: checkError } = await supabaseAdmin.storage
      .from("user-uploads")
      .list(dirPath, {
        search: baseName,
      });

    console.log("📊 File check result:", {
      found: fileExists?.length || 0,
      error: checkError?.message,
    });

    if (checkError || !fileExists || fileExists.length === 0) {
      console.error("❌ File not found in storage");
      console.error("   - Directory checked:", dirPath);
      console.error("   - Filename searched:", baseName);
      console.error("   - Error:", checkError);
      return errorResponse(
        res,
        "File not found in storage. Upload may have failed.",
        404
      );
    }

    // Get public URL using the storage path
    const { data: publicUrlData } = supabaseAdmin.storage
      .from("user-uploads")
      .getPublicUrl(storageFilePath);

    const fileUrl = publicUrlData.publicUrl;
    console.log("✅ File verified, public URL:", fileUrl);

    // Create database record
    const { data: fileRecord, error: dbError } = await supabaseAdmin
      .from("ticket_files")
      .insert([
        {
          ticket_id: ticketId,
          file_name: fileName,
          file_url: fileUrl,
          file_size: fileSize,
          file_type: mimeType,
          uploaded_by: userId,
        },
      ])
      .select("*")
      .single();

    if (dbError) {
      console.error("❌ Error creating file record:", dbError);
      return errorResponse(
        res,
        `Failed to create file record: ${dbError.message}`,
        500
      );
    }

    console.log("✅ Upload confirmed successfully");

    return successResponse(
      res,
      {
        file: fileRecord,
        fileUrl: fileUrl,
      },
      "File upload confirmed successfully"
    );
  } catch (error) {
    console.error("❌ Error confirming upload:", error);
    return errorResponse(
      res,
      `Failed to confirm upload: ${error.message}`,
      500
    );
  }
};

/**
 * Upload file for ticket message (Legacy - via Vercel)
 * POST /api/tickets/:ticketId/upload
 *
 * ⚠️ Limited by Vercel Hobby plan to 4.5MB
 * For larger files (5MB-50MB), use the direct upload endpoints above
 */

// Configure multer for memory storage (not disk)
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1, // Only 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Log file info
    console.log("📤 Attempting to upload:", {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size || "unknown",
    });

    // Allow all file types
    cb(null, true);
  },
});

// Error handler for multer errors
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error("❌ Multer error:", err);

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        message: "File too large",
        error: "File size exceeds 50MB limit",
        maxSize: "50MB",
        hint: "Please compress or split your file before uploading",
      });
    }

    if (err.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({
        success: false,
        message: "Too many files",
        error: "Only one file can be uploaded at a time",
      });
    }

    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        success: false,
        message: "Unexpected file field",
        error: 'File field name must be "file"',
      });
    }

    return res.status(400).json({
      success: false,
      message: "File upload error",
      error: err.message,
    });
  }

  // Other errors
  if (err) {
    console.error("❌ Upload error:", err);
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err.message,
    });
  }

  next();
};

export const uploadTicketFile = [
  upload.single("file"),
  handleMulterError, // Add error handler middleware
  async (req, res) => {
    try {
      const { ticketId } = req.params;
      const userId = req.user.id;

      if (!req.file) {
        return validationError(res, { field: "No file provided" });
      }

      console.log("📤 File uploaded:", {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      });

      // Check if user is a member of the ticket
      const { data: membership } = await supabaseAdmin
        .from("ticket_members")
        .select("*")
        .eq("ticket_id", ticketId)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        return errorResponse(res, "You do not have access to this ticket", 403);
      }

      // Generate unique filename
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const fileExt = path.extname(req.file.originalname);
      const fileName = `ticket-${ticketId}-${uniqueSuffix}${fileExt}`;
      const filePath = `ticket-files/${fileName}`;

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } =
        await supabaseAdmin.storage
          .from("user-uploads")
          .upload(filePath, req.file.buffer, {
            contentType: req.file.mimetype,
            upsert: true,
          });

      if (uploadError) {
        console.error("❌ Supabase upload error:", uploadError);
        return errorResponse(
          res,
          `Failed to upload file: ${uploadError.message}`,
          500
        );
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage
        .from("user-uploads")
        .getPublicUrl(filePath);

      const fileUrl = urlData.publicUrl;

      console.log("✅ File uploaded to Supabase:", fileUrl);

      // Add file record to database
      const { data: fileRecord, error: fileError } = await supabaseAdmin
        .from("ticket_files")
        .insert([
          {
            ticket_id: ticketId,
            file_name: req.file.originalname,
            file_url: fileUrl,
            file_size: req.file.size,
            file_type: req.file.mimetype,
            uploaded_by: userId,
          },
        ])
        .select("*")
        .single();

      if (fileError) {
        console.error("Error saving file record:", fileError);
        return errorResponse(res, "Failed to save file", 500);
      }

      return successResponse(
        res,
        {
          file: fileRecord,
          fileUrl: fileUrl,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
        },
        "File uploaded successfully"
      );
    } catch (error) {
      console.error("❌ Error uploading file:", error);
      return errorResponse(res, `Failed to upload file: ${error.message}`, 500);
    }
  },
];

/**
 * Update employee permissions for a ticket
 * PUT /api/tickets/:ticketId/members/:userId/permissions
 */
export const updateMemberPermissions = async (req, res) => {
  try {
    const { ticketId, userId } = req.params;
    const { can_message_client } = req.body;
    const adminId = req.user.id;

    // Check if requester is admin
    const { data: admin } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", adminId)
      .single();

    if (admin.role !== "admin") {
      return errorResponse(
        res,
        "Only admins can update member permissions",
        403
      );
    }

    // Check if the user is an employee
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (user.role !== "employee") {
      return errorResponse(
        res,
        "Permissions can only be set for employees",
        400
      );
    }

    // Update the ticket member permissions
    const { data, error } = await supabaseAdmin
      .from("ticket_members")
      .update({ can_message_client })
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("Error updating member permissions:", error);
      return errorResponse(res, "Failed to update permissions", 500);
    }

    return successResponse(res, data, "Permissions updated successfully");
  } catch (error) {
    console.error("Error updating member permissions:", error);
    return errorResponse(res, "Failed to update permissions", 500);
  }
};

/**
 * Star/Favorite a ticket
 * POST /api/tickets/:ticketId/star
 */
export const starTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;

    console.log("⭐ Star ticket request:", { ticketId, userId });

    // Check if user has access to this ticket
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (membershipError) {
      console.log("⭐ Membership check error (might be ok):", membershipError);
    }

    // Get user role
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (userError) {
      console.error("⭐ Error fetching user:", userError);
      return errorResponse(res, "Failed to fetch user details", 500);
    }

    console.log("⭐ User role:", user.role);
    console.log("⭐ Is member:", !!membership);

    // Allow access if user is admin, employee, or a member of the ticket
    if (!membership && user.role !== "admin" && user.role !== "employee") {
      console.log("⭐ Access denied - not a member and not admin/employee");
      return errorResponse(res, "You do not have access to this ticket", 403);
    }

    // Check if already starred
    const { data: existingStar, error: checkError } = await supabaseAdmin
      .from("starred_tickets")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      // PGRST116 = not found, which is ok
      console.error("⭐ Error checking existing star:", checkError);
      return errorResponse(res, `Database error: ${checkError.message}`, 500);
    }

    if (existingStar) {
      console.log("⭐ Ticket already starred");
      return successResponse(
        res,
        { isStarred: true },
        "Ticket is already starred"
      );
    }

    // Add star
    console.log("⭐ Attempting to insert star:", {
      ticket_id: ticketId,
      user_id: userId,
    });

    const { data: star, error: starError } = await supabaseAdmin
      .from("starred_tickets")
      .insert([
        {
          ticket_id: ticketId,
          user_id: userId,
        },
      ])
      .select()
      .single();

    if (starError) {
      console.error(
        "⭐ Error starring ticket - FULL ERROR:",
        JSON.stringify(starError, null, 2)
      );
      console.error("⭐ Error code:", starError.code);
      console.error("⭐ Error message:", starError.message);
      console.error("⭐ Error details:", starError.details);
      console.error("⭐ Error hint:", starError.hint);
      return errorResponse(
        res,
        `Failed to star ticket: ${starError.message}`,
        500
      );
    }

    console.log("⭐ Ticket starred successfully:", star);
    return successResponse(
      res,
      { isStarred: true, star },
      "Ticket starred successfully"
    );
  } catch (error) {
    console.error("⭐ Star ticket exception:", error);
    console.error("⭐ Exception stack:", error.stack);
    return errorResponse(res, `Failed to star ticket: ${error.message}`, 500);
  }
};

/**
 * Unstar/Unfavorite a ticket
 * POST /api/tickets/:ticketId/unstar
 */
export const unstarTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;

    // Remove star
    const { error: unstarError } = await supabaseAdmin
      .from("starred_tickets")
      .delete()
      .eq("ticket_id", ticketId)
      .eq("user_id", userId);

    if (unstarError) {
      console.error("Error unstarring ticket:", unstarError);
      return errorResponse(res, "Failed to unstar ticket", 500);
    }

    return successResponse(
      res,
      { isStarred: false },
      "Ticket unstarred successfully"
    );
  } catch (error) {
    console.error("Unstar ticket error:", error);
    return errorResponse(res, "Failed to unstar ticket", 500);
  }
};

/**
 * Check if current user is a member of a ticket
 * GET /api/tickets/:ticketId/membership
 *
 * Used by frontend for efficient polling after ticket creation
 * Returns: { isMember: boolean, membership: {...} | null }
 */
export const checkTicketMembership = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.id;

    console.log("🔍 Checking membership:", { ticketId, userId });

    // Check if user is a member
    const { data: membership, error: membershipError } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id, can_message_client, added_at, added_by")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      console.error("❌ Error checking membership:", membershipError);
      return errorResponse(res, "Failed to check membership", 500);
    }

    // Also check if user is the creator (clients who create tickets are always members)
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("created_by")
      .eq("id", ticketId)
      .single();

    const isCreator = ticket && ticket.created_by === userId;
    const isMember = !!membership || isCreator;

    console.log("✅ Membership check result:", {
      ticketId,
      userId,
      isMember,
      isCreator,
      hasMembershipRecord: !!membership,
    });

    return successResponse(
      res,
      {
        isMember,
        isCreator,
        membership: membership || null,
        ticketId,
        userId,
      },
      "Membership status retrieved"
    );
  } catch (error) {
    console.error("Check membership error:", error);
    return errorResponse(res, "Failed to check membership", 500);
  }
};

/**
 * Edit a message
 * PUT /api/tickets/:ticketId/messages/:messageId
 */
export const editMessage = async (req, res) => {
  try {
    const { ticketId, messageId } = req.params;
    const { message } = req.body;
    const userId = req.user.id;

    console.log("✏️ Edit message attempt:", { ticketId, messageId, userId });

    // Validation
    if (!message || message.trim() === "") {
      return validationError(res, { message: "Message content is required" });
    }

    // Get the message
    const { data: existingMessage, error: fetchError } = await supabaseAdmin
      .from("ticket_messages")
      .select("sender_id, message, is_deleted, message_type")
      .eq("id", messageId)
      .eq("ticket_id", ticketId)
      .single();

    if (fetchError || !existingMessage) {
      console.error("Message not found:", fetchError);
      return errorResponse(res, "Message not found", 404);
    }

    // Check if message is deleted
    if (existingMessage.is_deleted) {
      return errorResponse(res, "Cannot edit deleted message", 400);
    }

    // Check if message is a file (only text messages can be edited)
    if (existingMessage.message_type !== "text") {
      return errorResponse(res, "Only text messages can be edited", 400);
    }

    // Check if user is the sender
    if (existingMessage.sender_id !== userId) {
      return errorResponse(res, "You can only edit your own messages", 403);
    }

    // Save to history
    await supabaseAdmin.from("ticket_message_history").insert([
      {
        message_id: messageId,
        action: "edit",
        previous_content: existingMessage.message,
        performed_by: userId,
      },
    ]);

    // Update the message
    const { data: updatedMessage, error: updateError } = await supabaseAdmin
      .from("ticket_messages")
      .update({
        message: message.trim(),
        is_edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId)
      .select(
        `
        *,
        sender:users!ticket_messages_sender_id_fkey (
          id,
          email,
          name,
          profile_picture,
          role
        )
      `
      )
      .single();

    if (updateError) {
      console.error("Error updating message:", updateError);
      return errorResponse(res, "Failed to update message", 500);
    }

    console.log("✅ Message edited successfully");
    return successResponse(res, updatedMessage, "Message updated successfully");
  } catch (error) {
    console.error("Edit message error:", error);
    return errorResponse(res, "Failed to edit message", 500);
  }
};

/**
 * Delete a message
 * DELETE /api/tickets/:ticketId/messages/:messageId
 */
export const deleteMessage = async (req, res) => {
  try {
    const { ticketId, messageId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log("🗑️ Delete message attempt:", {
      ticketId,
      messageId,
      userId,
      userRole,
    });

    // Get the message
    const { data: existingMessage, error: fetchError } = await supabaseAdmin
      .from("ticket_messages")
      .select("sender_id, message, is_deleted, file_url")
      .eq("id", messageId)
      .eq("ticket_id", ticketId)
      .single();

    if (fetchError || !existingMessage) {
      console.error("Message not found:", fetchError);
      return errorResponse(res, "Message not found", 404);
    }

    // Check if already deleted
    if (existingMessage.is_deleted) {
      return errorResponse(res, "Message already deleted", 400);
    }

    // Check permissions: sender can delete own messages, admins can delete ANY message
    const isMessageOwner = existingMessage.sender_id === userId;
    const isAdmin = userRole === "admin";

    console.log("🔐 Delete permission check:", {
      userId,
      userRole,
      messageSenderId: existingMessage.sender_id,
      isMessageOwner,
      isAdmin,
      canDelete: isMessageOwner || isAdmin,
    });

    if (!isMessageOwner && !isAdmin) {
      return errorResponse(
        res,
        "You can only delete your own messages. Admins can delete any message.",
        403
      );
    }

    // Save to history
    await supabaseAdmin.from("ticket_message_history").insert([
      {
        message_id: messageId,
        action: "delete",
        previous_content: existingMessage.message,
        performed_by: userId,
      },
    ]);

    // Soft delete the message
    const { data: deletedMessage, error: deleteError } = await supabaseAdmin
      .from("ticket_messages")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        message:
          existingMessage.sender_id === userId
            ? "You deleted this message"
            : "This message was deleted",
        file_url: null, // Remove file URL for deleted messages
      })
      .eq("id", messageId)
      .select(
        `
        *,
        sender:users!ticket_messages_sender_id_fkey (
          id,
          email,
          name,
          profile_picture,
          role
        )
      `
      )
      .single();

    if (deleteError) {
      console.error("Error deleting message:", deleteError);
      return errorResponse(res, "Failed to delete message", 500);
    }

    console.log("✅ Message deleted successfully");
    return successResponse(res, deletedMessage, "Message deleted successfully");
  } catch (error) {
    console.error("Delete message error:", error);
    return errorResponse(res, "Failed to delete message", 500);
  }
};

/**
 * Forward a message to another ticket
 * POST /api/tickets/:ticketId/messages/:messageId/forward
 * Body: { targetTicketId: 'uuid', messageMode: 'client'|'internal' }
 */
export const forwardMessage = async (req, res) => {
  try {
    const { ticketId, messageId } = req.params;
    const { targetTicketId, messageMode } = req.body;
    const userId = req.user.id;
    const userRole = req.user.role;

    console.log("📤 Forward message attempt:", {
      fromTicket: ticketId,
      toTicket: targetTicketId,
      messageId,
      userId,
      userRole,
      messageMode,
    });

    // Validation
    if (!targetTicketId) {
      return validationError(res, { field: "targetTicketId is required" });
    }

    if (!messageMode || !["client", "internal"].includes(messageMode)) {
      return validationError(res, {
        field: 'messageMode must be "client" or "internal"',
      });
    }

    // Get the original message
    const { data: originalMessage, error: fetchError } = await supabaseAdmin
      .from("ticket_messages")
      .select("*, sender:users!ticket_messages_sender_id_fkey(id, name, email)")
      .eq("id", messageId)
      .eq("ticket_id", ticketId)
      .single();

    if (fetchError || !originalMessage) {
      console.error("Original message not found:", fetchError);
      return errorResponse(res, "Message not found", 404);
    }

    // Check if message is deleted
    if (originalMessage.is_deleted) {
      return errorResponse(res, "Cannot forward deleted message", 400);
    }

    // Check if user is member of source ticket
    const { data: sourceMembership } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", ticketId)
      .eq("user_id", userId)
      .single();

    if (!sourceMembership && userRole !== "admin" && userRole !== "employee") {
      return errorResponse(
        res,
        "You are not a member of the source ticket",
        403
      );
    }

    // Check if user is member of target ticket
    const { data: targetMembership } = await supabaseAdmin
      .from("ticket_members")
      .select("*")
      .eq("ticket_id", targetTicketId)
      .eq("user_id", userId)
      .single();

    const { data: targetTicket } = await supabaseAdmin
      .from("tickets")
      .select("created_by")
      .eq("id", targetTicketId)
      .single();

    const isTargetCreator = targetTicket && targetTicket.created_by === userId;

    if (
      !targetMembership &&
      !isTargetCreator &&
      userRole !== "admin" &&
      userRole !== "employee"
    ) {
      return errorResponse(
        res,
        "You are not a member of the target ticket",
        403
      );
    }

    // PERMISSION CHECK: Clients cannot forward to internal mode
    if (userRole === "client" && messageMode === "internal") {
      return errorResponse(
        res,
        "Clients cannot forward messages to internal mode",
        403
      );
    }

    // PERMISSION CHECK: Clients can only forward to client mode
    if (userRole === "client" && messageMode !== "client") {
      return errorResponse(
        res,
        "Clients can only forward messages in client mode",
        403
      );
    }

    // Create forwarded message with "Forwarded from" prefix
    const forwardedContent = `📨 Forwarded from ${originalMessage.sender.name || originalMessage.sender.email
      }:\n\n${originalMessage.message}`;

    const newMessageData = {
      ticket_id: targetTicketId,
      sender_id: userId,
      message: forwardedContent,
      message_type: originalMessage.message_type,
      message_mode: messageMode,
      file_url: originalMessage.file_url,
      file_name: originalMessage.file_name,
      file_size: originalMessage.file_size,
      file_mime_type: originalMessage.file_mime_type,
      is_read: false,
      forwarded_from_message_id: messageId,
      forwarded_from_ticket_id: ticketId,
    };

    const { data: forwardedMessage, error: insertError } = await supabaseAdmin
      .from("ticket_messages")
      .insert([newMessageData])
      .select(
        `
        *,
        sender:users!ticket_messages_sender_id_fkey (
          id,
          email,
          name,
          profile_picture,
          role
        )
      `
      )
      .single();

    if (insertError) {
      console.error("Error forwarding message:", insertError);
      return errorResponse(res, "Failed to forward message", 500);
    }

    console.log("✅ Message forwarded successfully");
    return successResponse(
      res,
      forwardedMessage,
      "Message forwarded successfully"
    );
  } catch (error) {
    console.error("Forward message error:", error);
    return errorResponse(res, "Failed to forward message", 500);
  }
};

/**
 * Export tickets to Excel file
 * GET /api/tickets/export
 * - Admin and Employee only
 * - Returns Excel file with 7 columns:
 *   1. Ticket Creation Date
 *   2. Client Name
 *   3. Employee Name and Freelancer Name
 *   4. Current Status
 *   5. Ticket ID (uid)
 *   6. Ticket Link
 *   7. Client Last Message
 */
export const exportTicketsToExcel = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log("📊 Export tickets request from user:", userId);

    // Get user role - only admin and employee can export
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (userError) {
      console.error("Error fetching user:", userError);
      return errorResponse(res, "Failed to fetch user details", 500);
    }

    if (user.role !== "admin" && user.role !== "employee") {
      return errorResponse(res, "Only admin and employees can export tickets", 403);
    }

    // Store user role for conditional column display
    const userRole = user.role;
    const isAdmin = userRole === "admin";

    // Fetch all tickets with related data using Supabase joins
    // This solves the N+1 problem by fetching everything in one query
    const { data: tickets, error: ticketsError } = await supabaseAdmin
      .from("tickets")
      .select(`
        *,
        created_by_user:users!created_by (id, name, role),
        members:ticket_members (
          user:users (id, name, role, phone)
        )
      `)
      .order("created_at", { ascending: false });

    if (ticketsError) {
      console.error("Error fetching tickets:", ticketsError);
      return errorResponse(res, "Failed to fetch tickets", 500);
    }

    if (!tickets || tickets.length === 0) {
      return errorResponse(res, "No tickets found to export", 404);
    }

    // Get frontend URL for ticket links
    const frontendUrl = process.env.FRONTEND_URL?.split(",")[0] || "http://localhost:5173";

    // Process each ticket to get all required data
    const ticketData = await Promise.all(
      tickets.map(async (ticket) => {
        // Data is now pre-fetched via joins - no extra DB calls needed for basic info!
        const creator = ticket.created_by_user;
        const members = ticket.members || [];

        // Extract users from the members relation
        const memberUsers = members.map(m => m.user).filter(Boolean);

        let employees = [];
        let freelancers = [];
        let clientName = "N/A";

        if (memberUsers.length > 0) {
          employees = memberUsers
            .filter((u) => u.role === "employee")
            .map((u) => u.name);
          freelancers = memberUsers
            .filter((u) => u.role === "freelancer")
            .map((u) => u.name);

          // Find client - either the creator or a member with client role
          const clientMember = memberUsers.find((u) => u.role === "client");
          if (clientMember) {
            clientName = clientMember.name || "N/A";
          } else if (creator && creator.role === "client") {
            clientName = creator.name || "N/A";
          }
        } else if (creator && creator.role === "client") {
          clientName = creator.name || "N/A";
        }

        // Get client's last message
        // Optimized: We already know who the clients are, so we only query the message
        let clientLastMessage = "N/A";

        // Identify client IDs for this ticket
        const clientIds = memberUsers
          .filter(u => u.role === "client")
          .map(u => u.id);

        if (creator && creator.role === "client") {
          clientIds.push(creator.id);
        }

        // Only query for message if we have clients involved
        if (clientIds.length > 0) {
          const { data: lastClientMsg } = await supabaseAdmin
            .from("ticket_messages")
            .select("message, message_type")
            .eq("ticket_id", ticket.id)
            .in("sender_id", clientIds)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastClientMsg) {
            if (lastClientMsg.message_type === "text") {
              clientLastMessage = lastClientMsg.message || "N/A";
            } else if (lastClientMsg.message_type === "file") {
              clientLastMessage = "📎 Sent a file";
            } else if (lastClientMsg.message_type === "image") {
              clientLastMessage = "🖼️ Sent an image";
            }
          }
        }

        // Format employee and freelancer names
        const employeeNames = employees.length > 0 ? employees.join(", ") : "N/A";
        const freelancerNames = freelancers.length > 0 ? freelancers.join(", ") : "N/A";
        const staffNames = [
          employees.length > 0 ? `Employees: ${employees.join(", ")}` : null,
          freelancers.length > 0 ? `Freelancers: ${freelancers.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" | ") || "N/A";

        // Get payment stages status
        const paymentStages = ticket.payment_stages || {
          part_a: { notified: false, completed: false },
          statistical_results: { notified: false, completed: false },
          part_b: { notified: false, completed: false },
        };

        const getStageStatus = (stage) => {
          if (!stage) return "Not Notified";
          if (stage.completed) return "Completed";
          if (stage.notified) return "Pending";
          return "Not Notified";
        };

        return {
          createdAt: new Date(ticket.created_at).toLocaleDateString("en-IN", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
          clientName,
          staffNames,
          status: ticket.status,
          ticketId: ticket.uid,
          ticketLink: `${frontendUrl}/dashboard?ticketId=${ticket.id}`,
          clientLastMessage,
          partAStatus: getStageStatus(paymentStages.part_a),
          statsStatus: getStageStatus(paymentStages.statistical_results),
          partBStatus: getStageStatus(paymentStages.part_b),
        };
      })
    );

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Medzen Innovations";
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet("Tickets Export");

    // Define base columns (always included)
    const baseColumns = [
      { header: "Ticket Creation Date", key: "createdAt", width: 22 },
      { header: "Client Name", key: "clientName", width: 20 },
      { header: "Employee / Freelancer Name", key: "staffNames", width: 35 },
      { header: "Current Status", key: "status", width: 20 },
      { header: "Ticket ID", key: "ticketId", width: 15 },
      { header: "Ticket Link", key: "ticketLink", width: 50 },
      { header: "Client Last Message", key: "clientLastMessage", width: 40 },
    ];

    // Payment columns (only for admins)
    const paymentColumns = [
      { header: "Part A Payment Status", key: "partAStatus", width: 22 },
      { header: "Statistics Payment Status", key: "statsStatus", width: 25 },
      { header: "Part B Payment Status", key: "partBStatus", width: 22 },
    ];

    // Set columns based on user role
    worksheet.columns = isAdmin
      ? [...baseColumns, ...paymentColumns]
      : baseColumns;

    // Style the header row
    worksheet.getRow(1).font = { bold: true, size: 12 };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4F81BD" },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    // Add data rows
    ticketData.forEach((row) => {
      worksheet.addRow(row);
    });

    // Auto-fit row heights and add borders
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
        cell.alignment = { vertical: "middle", wrapText: true };
      });
    });

    // Generate filename with date
    const dateStr = new Date().toISOString().split("T")[0];
    const filename = `tickets-export-${dateStr}.xlsx`;

    // Set response headers for file download
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

    // Write to response
    await workbook.xlsx.write(res);
    console.log(`✅ Exported ${ticketData.length} tickets to Excel`);
    res.end();
  } catch (error) {
    console.error("Export tickets error:", error);
    return errorResponse(res, `Failed to export tickets: ${error.message}`, 500);
  }
};

/**
 * Send payment stage notification to client via WhatsApp
 * POST /api/tickets/:ticketId/payment-stage/notify
 * - Admin and Employee only
 * - Stages: part_a, statistical_results, part_b
 */
export const sendPaymentStageNotification = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { stage } = req.body;
    const userId = req.user.id;

    console.log("💰 Payment stage notification request:", { ticketId, stage, userId });

    // Validate stage
    const validStages = ["part_a", "statistical_results", "part_b"];
    if (!stage || !validStages.includes(stage)) {
      return validationError(res, {
        stage: `Invalid stage. Must be one of: ${validStages.join(", ")}`,
      });
    }

    // Get user role
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (userError) {
      return errorResponse(res, "Failed to fetch user details", 500);
    }

    if (user.role !== "admin" && user.role !== "employee") {
      return errorResponse(res, "Only admin and employees can send payment notifications", 403);
    }

    // Get ticket details
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("*, created_by_user:users!created_by(id, name, email, phone, role)")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return errorResponse(res, "Ticket not found", 404);
    }

    // Get client's phone number
    // First check if creator is a client
    let clientPhone = null;
    let clientName = null;

    if (ticket.created_by_user?.role === "client" && ticket.created_by_user?.phone) {
      clientPhone = ticket.created_by_user.phone;
      clientName = ticket.created_by_user.name;
    } else {
      // Find a client member with phone
      const { data: members } = await supabaseAdmin
        .from("ticket_members")
        .select("user_id")
        .eq("ticket_id", ticketId);

      if (members && members.length > 0) {
        const { data: clientMember } = await supabaseAdmin
          .from("users")
          .select("id, name, phone, role")
          .in("id", members.map((m) => m.user_id))
          .eq("role", "client")
          .not("phone", "is", null)
          .limit(1)
          .maybeSingle();

        if (clientMember) {
          clientPhone = clientMember.phone;
          clientName = clientMember.name;
        }
      }
    }

    if (!clientPhone) {
      return errorResponse(res, "Client phone number not found for this ticket", 400);
    }

    // Send WhatsApp message
    const ticketInfo = {
      ticketNumber: ticket.ticket_number,
      title: ticket.title,
      uid: ticket.uid,
    };

    const whatsappResult = await sendPaymentStageWhatsApp(clientPhone, ticketInfo, stage);

    if (!whatsappResult.success) {
      console.error("WhatsApp send failed:", whatsappResult.error);
      // Continue to update the stage even if WhatsApp fails (log the attempt)
    }

    // Update payment_stages in the ticket
    const currentStages = ticket.payment_stages || {
      part_a: { notified: false, completed: false },
      statistical_results: { notified: false, completed: false },
      part_b: { notified: false, completed: false },
    };

    currentStages[stage] = {
      ...currentStages[stage],
      notified: true,
      notified_at: new Date().toISOString(),
      notified_by: userId,
    };

    const { error: updateError } = await supabaseAdmin
      .from("tickets")
      .update({ payment_stages: currentStages })
      .eq("id", ticketId);

    if (updateError) {
      console.error("Error updating payment stages:", updateError);
      return errorResponse(res, "Failed to update payment stage", 500);
    }

    const stageNames = {
      part_a: "Part A",
      statistical_results: "Statistical Results",
      part_b: "Part B",
    };

    console.log(`✅ Payment stage notification sent for ${stageNames[stage]}`);

    return successResponse(
      res,
      {
        stage,
        stageName: stageNames[stage],
        notified: true,
        whatsappSent: whatsappResult.success,
        clientName,
        payment_stages: currentStages,
      },
      `Payment notification sent for ${stageNames[stage]}`
    );
  } catch (error) {
    console.error("Payment stage notification error:", error);
    return errorResponse(res, `Failed to send notification: ${error.message}`, 500);
  }
};

/**
 * Mark payment stage as completed
 * POST /api/tickets/:ticketId/payment-stage/complete
 * - Admin and Employee only
 * - Stages: part_a, statistical_results, part_b
 */
export const markPaymentStageCompleted = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { stage } = req.body;
    const userId = req.user.id;

    console.log("✅ Payment stage completion request:", { ticketId, stage, userId });

    // Validate stage
    const validStages = ["part_a", "statistical_results", "part_b"];
    if (!stage || !validStages.includes(stage)) {
      return validationError(res, {
        stage: `Invalid stage. Must be one of: ${validStages.join(", ")}`,
      });
    }

    // Get user role
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", userId)
      .single();

    if (userError) {
      return errorResponse(res, "Failed to fetch user details", 500);
    }

    if (user.role !== "admin" && user.role !== "employee") {
      return errorResponse(res, "Only admin and employees can mark payment stages as completed", 403);
    }

    // Get ticket
    const { data: ticket, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select("payment_stages")
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return errorResponse(res, "Ticket not found", 404);
    }

    // Update payment_stages
    const currentStages = ticket.payment_stages || {
      part_a: { notified: false, completed: false },
      statistical_results: { notified: false, completed: false },
      part_b: { notified: false, completed: false },
    };

    currentStages[stage] = {
      ...currentStages[stage],
      completed: true,
      completed_at: new Date().toISOString(),
      completed_by: userId,
    };

    const { error: updateError } = await supabaseAdmin
      .from("tickets")
      .update({ payment_stages: currentStages })
      .eq("id", ticketId);

    if (updateError) {
      console.error("Error updating payment stages:", updateError);
      return errorResponse(res, "Failed to mark stage as completed", 500);
    }

    const stageNames = {
      part_a: "Part A",
      statistical_results: "Statistical Results",
      part_b: "Part B",
    };

    console.log(`✅ Payment stage ${stageNames[stage]} marked as completed`);

    return successResponse(
      res,
      {
        stage,
        stageName: stageNames[stage],
        completed: true,
        payment_stages: currentStages,
      },
      `${stageNames[stage]} marked as completed`
    );
  } catch (error) {
    console.error("Payment stage completion error:", error);
    return errorResponse(res, `Failed to mark stage as completed: ${error.message}`, 500);
  }
};
