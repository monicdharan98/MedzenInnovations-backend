import { supabaseAdmin } from "../config/supabase.js";

/**
 * Helper function to create notifications
 */

/**
 * Check if user has enabled a specific notification type
 * @param {string} userId - The user ID
 * @param {string} notificationType - The notification type to check
 * @returns {Promise<boolean>} - Whether the user has enabled this notification type
 */
const isNotificationEnabled = async (userId, notificationType) => {
  try {
    const { data: preferences } = await supabaseAdmin
      .from("notification_preferences")
      .select(notificationType)
      .eq("user_id", userId)
      .single();

    // If no preferences exist, return true (default enabled)
    if (!preferences) return true;

    return preferences[notificationType] === true;
  } catch (error) {
    // If error or no preferences, default to enabled
    return true;
  }
};

/**
 * Create notification for admin about new user request
 * @param {string} userId - The new user's ID
 */
export const createUserRequestNotification = async (userId) => {
  try {
    // Get the new user's details
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role")
      .eq("id", userId)
      .single();

    if (!user) return;

    // Get all admins
    const { data: admins } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("role", "admin")
      .eq("approval_status", "approved");

    if (!admins || admins.length === 0) return;

    // Check if notification already exists for this user (prevent duplicates)
    const { data: existingNotifications } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("type", "user_request")
      .eq("related_user_id", userId)
      .limit(1);

    if (existingNotifications && existingNotifications.length > 0) {
      console.log(
        `⚠️ Notification already exists for user ${userId}, skipping duplicate creation`
      );
      return;
    }

    // Different message for clients vs employees/freelancers
    const notificationTitle = user.role === "client"
      ? "New Client Registration"
      : "New User Registration";

    const notificationMessage = user.role === "client"
      ? `${user.name || user.email} joined as client`
      : `${user.name || user.email} is waiting for approval as ${user.role}`;

    // Create notification for each admin
    const notifications = admins.map((admin) => ({
      user_id: admin.id,
      type: "user_request",
      title: notificationTitle,
      message: notificationMessage,
      related_user_id: userId,
      is_read: false,
    }));

    await supabaseAdmin.from("notifications").insert(notifications);

    console.log(
      `✅ Created user request notifications for ${admins.length} admins`
    );
  } catch (error) {
    console.error("Error creating user request notification:", error);
  }
};

/**
 * Create notification when user is added to a ticket
 * NOTE: Creator should NOT receive notification when they create the ticket
 * @param {string} ticketId - The ticket ID
 * @param {string} userId - The user being added
 * @param {string} addedBy - The user who added them
 */
export const createTicketAssignedNotification = async (
  ticketId,
  userId,
  addedBy
) => {
  try {
    // Don't notify if user is adding themselves (creator scenario)
    if (userId === addedBy) {
      console.log(
        `⏭️ Skipping notification - user ${userId} is the creator/adder`
      );
      return;
    }

    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, title, ticket_number")
      .eq("id", ticketId)
      .single();

    const { data: adder } = await supabaseAdmin
      .from("users")
      .select("id, name, email")
      .eq("id", addedBy)
      .single();

    if (!ticket || !adder) return;

    // Check if notification already exists for this user and ticket (prevent duplicates)
    const { data: existingNotifications } = await supabaseAdmin
      .from("notifications")
      .select("id")
      .eq("type", "ticket_assigned")
      .eq("user_id", userId)
      .eq("related_ticket_id", ticketId)
      .limit(1);

    if (existingNotifications && existingNotifications.length > 0) {
      console.log(
        `⚠️ Notification already exists for user ${userId} being added to ticket ${ticketId}, skipping duplicate creation`
      );
      return;
    }

    // NOTE: ticket_assigned is ALWAYS enabled (not user-configurable)
    // So we don't check preferences for this type

    await supabaseAdmin.from("notifications").insert([
      {
        user_id: userId,
        type: "ticket_assigned",
        title: "Added to Ticket",
        message: `${adder.name || adder.email} added you to "${ticket.title
          }" (${ticket.ticket_number})`,
        related_user_id: addedBy,
        related_ticket_id: ticketId,
        is_read: false,
      },
    ]);

    console.log(`✅ Created ticket assigned notification for user ${userId}`);
  } catch (error) {
    console.error("Error creating ticket assigned notification:", error);
  }
};

/**
 * Create notification when a message is sent in a ticket
 * @param {string} ticketId - The ticket ID
 * @param {string} senderId - The user who sent the message
 * @param {string} messageType - Type of message (text, file, etc.)
 * @param {string} messageMode - Message mode (client or internal)
 */
export const createTicketMessageNotification = async (
  ticketId,
  senderId,
  messageType = "text",
  messageMode = "client"
) => {
  try {
    console.log(`📢 === CREATE TICKET MESSAGE NOTIFICATION ===`);
    console.log(
      `📋 Input: ticketId=${ticketId}, senderId=${senderId}, messageType=${messageType}, messageMode=${messageMode}`
    );

    // Get ticket details
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, title, ticket_number")
      .eq("id", ticketId)
      .single();

    // Get sender details
    const { data: sender } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role")
      .eq("id", senderId)
      .single();

    console.log(
      `👤 Sender: ${sender?.name || sender?.email}, Role: ${sender?.role}`
    );
    console.log(`🎫 Ticket: ${ticket?.title} (${ticket?.ticket_number})`);

    // Get ALL ticket members first (don't filter by sender yet)
    console.log(`🔍 Querying ALL ticket_members for ticket ${ticketId}`);

    const { data: allMembers, error: membersError } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id")
      .eq("ticket_id", ticketId);

    console.log(`📊 Query result:`, {
      totalMembers: allMembers?.length || 0,
      allMemberIds: allMembers?.map((m) => m.user_id) || [],
      senderId: senderId,
      error: membersError ? membersError.message : null,
    });

    if (!ticket || !sender) {
      console.log("⚠️ Missing ticket or sender data");
      return;
    }

    if (!allMembers || allMembers.length === 0) {
      console.log("⚠️ No members found in ticket at all!");
      return;
    }

    // Filter out the sender manually (more reliable than .neq())
    const members = allMembers.filter((m) => m.user_id !== senderId);

    console.log(
      `� After filtering sender: ${members.length} members remain:`,
      members.map((m) => m.user_id)
    );

    if (members.length === 0) {
      console.log("⚠️ No other members to notify (only sender in ticket)");
      return;
    }

    // Fetch user details for each member
    console.log(`🔄 Fetching user details for ${members.length} members...`);

    const memberUsers = await Promise.all(
      members.map(async (m) => {
        try {
          const { data: user, error: userError } = await supabaseAdmin
            .from("users")
            .select("id, role, name")
            .eq("id", m.user_id)
            .single();

          if (userError) {
            console.log(
              `⚠️ Error fetching user ${m.user_id}:`,
              userError.message
            );
            return null;
          }

          if (!user) {
            console.log(`⚠️ User not found: ${m.user_id}`);
            return null;
          }

          console.log(`✅ Fetched user: ${user.name} (${user.role})`);
          return { user_id: m.user_id, users: user };
        } catch (err) {
          console.error(`❌ Exception fetching user ${m.user_id}:`, err);
          return null;
        }
      })
    );
    const validMembers = memberUsers.filter((m) => m !== null);

    console.log(
      `👥 Found ${validMembers.length} valid ticket members (excluding sender):`,
      validMembers.map((m) => `${m.users.name || m.user_id} (${m.users.role})`)
    );

    // For internal messages, EXCLUDE clients from notifications
    let notificationRecipients = validMembers;
    if (messageMode === "internal") {
      console.log("🔒 Internal message - filtering out clients");
      notificationRecipients = validMembers.filter(
        (m) => m.users.role !== "client"
      );
      console.log(
        `✅ Filtered to ${notificationRecipients.length} non-client recipients`
      );
    } else {
      console.log("💬 Client mode message - notifying all members");
    }

    if (notificationRecipients.length === 0) {
      console.log("⚠️ No eligible recipients after filtering");
      return;
    }

    // Determine notification type based on sender role
    // - If CLIENT sends: admins/employees get chat_clients notification
    // - If ADMIN/EMPLOYEE sends in client mode: client gets chat_clients notification
    // - If ADMIN/EMPLOYEE sends in internal mode: team gets chat_internal notification

    // For simplicity:
    // - Messages FROM clients → chat_clients type (notifies admins/employees)
    // - Messages FROM team TO clients (client mode) → chat_clients type (notifies clients)
    // - Messages FROM team in internal mode → chat_internal type (notifies team only)

    const notificationPreferenceType =
      sender.role === "client"
        ? "chat_clients"
        : messageMode === "internal"
          ? "chat_internal"
          : "chat_clients";

    console.log(
      `📋 Notification preference type: ${notificationPreferenceType}`
    );
    console.log(
      `💡 Logic: sender.role='${sender.role}', mode='${messageMode}' → type='${notificationPreferenceType}'`
    );

    // Filter recipients based on their notification preferences
    console.log(
      `🔍 Checking notification preferences for ${notificationRecipients.length} recipients...`
    );

    const recipientsWithPreferences = await Promise.all(
      notificationRecipients.map(async (member) => {
        const isEnabled = await isNotificationEnabled(
          member.user_id,
          notificationPreferenceType
        );
        console.log(
          `   - ${member.users.name || member.user_id
          }: ${notificationPreferenceType} = ${isEnabled ? "✅ enabled" : "❌ disabled"
          }`
        );
        return isEnabled ? member : null;
      })
    );

    const filteredRecipients = recipientsWithPreferences.filter(
      (r) => r !== null
    );

    if (filteredRecipients.length === 0) {
      console.log(
        `❌ No recipients have ${notificationPreferenceType} notifications enabled`
      );
      return;
    }

    console.log(
      `✅ ${filteredRecipients.length} recipients with notifications enabled:`,
      filteredRecipients.map((r) => r.users.name || r.user_id)
    );

    // Create message based on type and include ticket name
    let messageText;
    if (messageType === "file" || messageType === "image") {
      messageText = `${sender.name || sender.email} shared a file in "${ticket.title
        }" (${ticket.ticket_number})`;
    } else {
      messageText = `${sender.name || sender.email} sent a message in "${ticket.title
        }" (${ticket.ticket_number})`;
    }

    // Add mode indicator for internal messages
    if (messageMode === "internal") {
      messageText += " [Internal]";
    }

    // Create notifications for relevant members
    const notifications = filteredRecipients.map((member) => ({
      user_id: member.user_id,
      type: notificationPreferenceType,
      title: "New Message",
      message: messageText,
      related_user_id: senderId,
      related_ticket_id: ticketId,
      is_read: false,
    }));

    console.log(
      `💾 Inserting ${notifications.length} notifications:`,
      notifications.map((n) => ({
        recipient: n.user_id,
        type: n.type,
        message: n.message,
      }))
    );

    const { data: insertedNotifs, error: insertError } = await supabaseAdmin
      .from("notifications")
      .insert(notifications)
      .select("id, user_id");

    if (insertError) {
      console.error("❌ Error inserting notifications:", insertError);
    } else {
      console.log(
        `✅ Successfully created ${insertedNotifs?.length || 0} notifications`
      );
    }

    console.log(
      `✅ Notification creation complete (mode: ${messageMode}, type: ${notificationPreferenceType})`
    );
    console.log(`=== END CREATE TICKET MESSAGE NOTIFICATION ===`);
  } catch (error) {
    console.error("❌ Error in createTicketMessageNotification:", error);
  }
};

/**
 * Create notification when ticket status changes
 * @param {string} ticketId - The ticket ID
 * @param {string} oldStatus - The old status
 * @param {string} newStatus - The new status
 * @param {string} changedBy - The user who changed the status
 */
export const createTicketStatusChangeNotification = async (
  ticketId,
  oldStatus,
  newStatus,
  changedBy
) => {
  try {
    console.log(
      `📊 Creating status change notification: ${oldStatus} → ${newStatus}`
    );

    // Get ticket details
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, title, ticket_number")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      console.log("⚠️ Ticket not found");
      return;
    }

    // Get all ticket members (don't exclude changedBy yet - we'll check their preferences)
    const { data: members } = await supabaseAdmin
      .from("ticket_members")
      .select("user_id")
      .eq("ticket_id", ticketId);

    if (!members || members.length === 0) {
      console.log("⚠️ No ticket members found");
      return;
    }

    console.log(`👥 Found ${members.length} ticket members`);

    // Filter members based on status_change preference
    const recipientsWithPreferences = await Promise.all(
      members.map(async (member) => {
        // Skip the user who made the change
        if (member.user_id === changedBy) {
          console.log(`⏭️ Skipping ${member.user_id} - they made the change`);
          return null;
        }

        const isEnabled = await isNotificationEnabled(
          member.user_id,
          "status_change"
        );
        console.log(
          `   - ${member.user_id}: status_change = ${isEnabled ? "✅ enabled" : "❌ disabled"
          }`
        );
        return isEnabled ? member : null;
      })
    );

    const filteredRecipients = recipientsWithPreferences.filter(
      (r) => r !== null
    );

    if (filteredRecipients.length === 0) {
      console.log(`⚠️ No recipients have status_change notifications enabled`);
      return;
    }

    // Create notifications with ticket name
    const notifications = filteredRecipients.map((member) => ({
      user_id: member.user_id,
      type: "status_change",
      title: "Ticket Status Updated",
      message: `"${ticket.title}" (${ticket.ticket_number}) status changed: ${oldStatus} → ${newStatus}`,
      related_user_id: changedBy,
      related_ticket_id: ticketId,
      is_read: false,
    }));

    await supabaseAdmin.from("notifications").insert(notifications);

    console.log(
      `✅ Created status change notifications for ${filteredRecipients.length} members`
    );
  } catch (error) {
    console.error("Error creating ticket status change notification:", error);
  }
};

/**
 * Create notification when a new ticket is created
 * NOTE: Only notify ADMINS (not all employees)
 * Employees will only get notifications for tickets they are assigned to or members of
 * @param {string} ticketId - The ticket ID
 * @param {string} createdBy - The user who created the ticket
 */
export const createTicketCreationNotification = async (ticketId, createdBy) => {
  try {
    console.log(
      `🎫 Creating ticket creation notifications for ticket ${ticketId}`
    );

    // Get ticket details
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, title, ticket_number")
      .eq("id", ticketId)
      .single();

    if (!ticket) {
      console.log("⚠️ Ticket not found");
      return;
    }

    // Get creator details
    const { data: creator } = await supabaseAdmin
      .from("users")
      .select("id, name, email, role")
      .eq("id", createdBy)
      .single();

    if (!creator) {
      console.log("⚠️ Creator not found");
      return;
    }

    // IMPORTANT: Only notify ADMINS about new ticket creation
    // Employees will only get notifications for tickets they are assigned to or members of
    const { data: admins } = await supabaseAdmin
      .from("users")
      .select("id, name, role")
      .eq("role", "admin")
      .eq("approval_status", "approved");

    if (!admins || admins.length === 0) {
      console.log("⚠️ No admins found");
      return;
    }

    console.log(`👥 Found ${admins.length} admins`);

    // Filter admins based on ticket_creation preference
    const recipientsWithPreferences = await Promise.all(
      admins.map(async (admin) => {
        // CRITICAL: Don't notify the creator
        if (admin.id === createdBy) {
          console.log(
            `⏭️ Skipping ${admin.name || admin.id} - they are the creator`
          );
          return null;
        }

        const isEnabled = await isNotificationEnabled(
          admin.id,
          "ticket_creation"
        );
        console.log(
          `   - ${admin.name || admin.id}: ticket_creation = ${isEnabled ? "✅ enabled" : "❌ disabled"
          }`
        );
        return isEnabled ? admin : null;
      })
    );

    const filteredRecipients = recipientsWithPreferences.filter(
      (r) => r !== null
    );

    if (filteredRecipients.length === 0) {
      console.log(`⚠️ No admins have ticket_creation notifications enabled`);
      return;
    }

    // Create notifications with ticket name and creator info
    const notifications = filteredRecipients.map((admin) => ({
      user_id: admin.id,
      type: "ticket_creation",
      title: "New Ticket Created",
      message: `${creator.name || creator.email} created "${ticket.title}" (${ticket.ticket_number
        })`,
      related_user_id: createdBy,
      related_ticket_id: ticketId,
      is_read: false,
    }));

    await supabaseAdmin.from("notifications").insert(notifications);

    console.log(
      `✅ Created ticket creation notifications for ${filteredRecipients.length} admins (employees excluded)`
    );
  } catch (error) {
    console.error("Error creating ticket creation notification:", error);
  }
};

/**
 * Create notification when user is approved
 * @param {string} userId - The user being approved
 */
export const createUserApprovedNotification = async (userId) => {
  try {
    await supabaseAdmin.from("notifications").insert([
      {
        user_id: userId,
        type: "user_approved",
        title: "Account Approved",
        message:
          "Your account has been approved! You can now access all features.",
        is_read: false,
      },
    ]);

    console.log(`✅ Created user approved notification for user ${userId}`);
  } catch (error) {
    console.error("Error creating user approved notification:", error);
  }
};

/**
 * Create notification when user is rejected
 * @param {string} userId - The user being rejected
 */
export const createUserRejectedNotification = async (userId) => {
  try {
    await supabaseAdmin.from("notifications").insert([
      {
        user_id: userId,
        type: "user_rejected",
        title: "Account Rejected",
        message:
          "Unfortunately, your account request has been rejected. Please contact support for more information.",
        is_read: false,
      },
    ]);

    console.log(`✅ Created user rejected notification for user ${userId}`);
  } catch (error) {
    console.error("Error creating user rejected notification:", error);
  }
};
