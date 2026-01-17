import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../config/supabase.js';
import { createTicketMessageNotification } from '../utils/notificationHelper.js';
import { sendTicketMessageEmail } from '../utils/emailService.js';

/**
 * Handle all socket.io chat events
 */
export const setupChatHandlers = (io) => {
  // Middleware to authenticate socket connections
  io.use(async (socket, next) => {
    try {
      console.log('🔧 Socket authentication attempt from:', socket.handshake.address);
      console.log('🔧 Auth token exists:', !!socket.handshake.auth.token);

      const token = socket.handshake.auth.token;

      if (!token) {
        console.error('❌ No authentication token provided');
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // OPTIMIZATION: Use decoded token data instead of DB fetch to reduce latency
      // The token contains: userId, email, role, name
      const user = {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role,
        name: decoded.name
      };

      console.log('✅ User authenticated (Fast Path):', {
        email: user.email,
        role: user.role,
        id: user.id
      });

      // Attach user to socket
      socket.user = user;
      next();
    } catch (error) {
      console.error('❌ Socket authentication error:', error.message);
      next(new Error('Authentication failed'));
    }
  });

  // Handle connection
  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.user.email} (${socket.id})`);

    // Join user's personal room for private notifications
    socket.join(`user:${socket.user.id}`);

    /**
     * Join a ticket chat room
     * Client emits: { ticketId: 'uuid' }
     */
    socket.on('join_ticket', async (data) => {
      try {
        const { ticketId } = data;

        console.log(`🎯 join_ticket attempt: userId=${socket.user.id}, ticketId=${ticketId}, role=${socket.user.role}`);

        // For CLIENTS: Check if they created the ticket OR are in ticket_members
        if (socket.user.role === 'client') {
          const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('created_by')
            .eq('id', ticketId)
            .single();

          // Allow if client created the ticket
          if (ticket && ticket.created_by === socket.user.id) {
            socket.join(`ticket:${ticketId}`);
            console.log(`✅ Client ${socket.user.email} joined ticket ${ticketId} (creator)`);

            socket.to(`ticket:${ticketId}`).emit('user_joined', {
              userId: socket.user.id,
              userName: socket.user.name,
              ticketId
            });

            socket.emit('joined_ticket', { ticketId });
            return;
          }

          // OR if client is in ticket_members
          const { data: membership } = await supabaseAdmin
            .from('ticket_members')
            .select('*')
            .eq('ticket_id', ticketId)
            .eq('user_id', socket.user.id)
            .single();

          if (membership) {
            socket.join(`ticket:${ticketId}`);
            console.log(`✅ Client ${socket.user.email} joined ticket ${ticketId} (member)`);

            socket.to(`ticket:${ticketId}`).emit('user_joined', {
              userId: socket.user.id,
              userName: socket.user.name,
              ticketId
            });

            socket.emit('joined_ticket', { ticketId });
            return;
          }

          // Reject if neither
          console.log(`❌ Client ${socket.user.email} not authorized for ticket ${ticketId}`);
          socket.emit('error', { message: 'You are not a member of this ticket' });
          return;
        }

        // For TEAM MEMBERS (admin, employee, freelancer): Check membership
        const { data: membership, error } = await supabaseAdmin
          .from('ticket_members')
          .select('*')
          .eq('ticket_id', ticketId)
          .eq('user_id', socket.user.id)
          .single();

        // ADMINS and EMPLOYEES can view all tickets (read-only if not member)
        // FREELANCERS must be added as members
        if (!membership && socket.user.role !== 'admin' && socket.user.role !== 'employee') {
          console.log(`❌ Freelancer ${socket.user.email} not authorized for ticket ${ticketId}`);
          socket.emit('error', { message: 'You must be added to this ticket by an admin to access it' });
          return;
        }

        // Join the ticket room
        socket.join(`ticket:${ticketId}`);
        console.log(`✅ User ${socket.user.email} joined ticket ${ticketId}`);

        // Notify others in the ticket
        socket.to(`ticket:${ticketId}`).emit('user_joined', {
          userId: socket.user.id,
          userName: socket.user.name,
          ticketId
        });

        // Send confirmation to user
        socket.emit('joined_ticket', { ticketId });
      } catch (error) {
        console.error('Error joining ticket:', error);
        socket.emit('error', { message: 'Failed to join ticket' });
      }
    });

    /**
     * Leave a ticket chat room
     * Client emits: { ticketId: 'uuid' }
     */
    socket.on('leave_ticket', (data) => {
      const { ticketId } = data;
      socket.leave(`ticket:${ticketId}`);

      // Notify others in the ticket
      socket.to(`ticket:${ticketId}`).emit('user_left', {
        userId: socket.user.id,
        userName: socket.user.name,
        ticketId
      });

      console.log(`User ${socket.user.email} left ticket ${ticketId}`);
    });

    /**
     * Send a message to a ticket
     * Client emits: { ticketId: 'uuid', message: 'text', messageType: 'text', messageMode: 'client'|'internal', replyToId: 'uuid', fileUrl: '', fileName: '', fileSize: number, fileMimeType: '' }
     */
    socket.on('send_message', async (data) => {
      try {
        const {
          ticketId,
          message,
          messageType = 'text',
          fileUrl = null,
          messageMode = 'client',
          replyToId = null,
          fileName = null,
          fileSize = null,
          fileMimeType = null
        } = data;

        console.log(`🎯 send_message attempt: userId=${socket.user.id}, ticketId=${ticketId}, role=${socket.user.role}, messageMode=${messageMode}`);

        // Check membership first (same logic as join_ticket)
        let isMember = false;
        let membership = null;

        if (socket.user.role === 'client') {
          const { data: ticket } = await supabaseAdmin
            .from('tickets')
            .select('created_by')
            .eq('id', ticketId)
            .single();

          // Client is member if they created ticket
          if (ticket && ticket.created_by === socket.user.id) {
            isMember = true;
          } else {
            // Or if they're in ticket_members
            const { data: memberRecord } = await supabaseAdmin
              .from('ticket_members')
              .select('*')
              .eq('ticket_id', ticketId)
              .eq('user_id', socket.user.id)
              .single();

            if (memberRecord) {
              isMember = true;
              membership = memberRecord;
            }
          }

          if (!isMember) {
            console.log(`❌ Client not a member of ticket ${ticketId}`);
            socket.emit('error', { message: 'You are not a member of this ticket' });
            return;
          }

          // ✅ ALLOW clients to send in "client" mode
          if (messageMode !== 'client') {
            socket.emit('error', {
              message: 'Clients can only send messages in client mode'
            });
            return;
          }
        } else {
          // Team members (admin, employee, freelancer): Check if they're in ticket_members
          const { data: memberRecord } = await supabaseAdmin
            .from('ticket_members')
            .select('*, can_message_client')
            .eq('ticket_id', ticketId)
            .eq('user_id', socket.user.id)
            .single();

          if (!memberRecord) {
            console.log(`❌ User ${socket.user.role} not a member of ticket ${ticketId}`);
            socket.emit('error', { message: 'You must be added to this ticket by an admin to send messages' });
            return;
          }

          membership = memberRecord;
          isMember = true;

          // ADMINS, EMPLOYEES, and FREELANCERS can all send in both client and internal mode if added as member
          // No additional restrictions for freelancers once they are added to the ticket
        }

        // Log what we're about to save
        console.log('💾 About to save message to DB:', {
          ticketId,
          senderId: socket.user.id,
          message,
          messageType,
          messageMode,
          fileUrl,
          replyToId,
          fileName,
          fileSize,
          fileMimeType,
          fileUrlType: typeof fileUrl,
          fileUrlLength: fileUrl?.length
        });

        // Save message to database with message_mode and reply support
        const { data: newMessage, error } = await supabaseAdmin
          .from('ticket_messages')
          .insert([{
            ticket_id: ticketId,
            sender_id: socket.user.id,
            message,
            message_type: messageType,
            message_mode: messageMode,
            file_url: fileUrl,
            reply_to_message_id: replyToId,
            file_name: fileName,
            file_size: fileSize,
            file_mime_type: fileMimeType,
            is_read: false
          }])
          .select('*')
          .single();

        // Log what we got back from the database
        console.log('💾 Message saved to DB:', {
          messageId: newMessage?.id,
          storedFileUrl: newMessage?.file_url,
          storedFileUrlType: typeof newMessage?.file_url,
          storedFileUrlLength: newMessage?.file_url?.length
        });

        if (error) {
          console.error('Error saving message:', error);
          socket.emit('error', { message: 'Failed to send message' });
          return;
        }

        // Fetch sender details
        const { data: sender } = await supabaseAdmin
          .from('users')
          .select('id, email, name, profile_picture, role')
          .eq('id', socket.user.id)
          .single();

        // Fetch reply-to message if exists
        let replyToMessage = null;
        if (replyToId) {
          console.log('🔔 Backend: Fetching reply-to message with ID:', replyToId);

          const { data: replyMsg, error: replyError } = await supabaseAdmin
            .from('ticket_messages')
            .select('id, sender_id, message, message_type, file_name, is_deleted, created_at')
            .eq('id', replyToId)
            .single();

          if (replyError) {
            console.error('❌ Backend: Error fetching reply message:', replyError);
          }

          if (!replyError && replyMsg) {
            console.log('✅ Backend: Found reply message:', {
              id: replyMsg.id,
              sender_id: replyMsg.sender_id,
              message_preview: replyMsg.message?.substring(0, 50),
              is_deleted: replyMsg.is_deleted
            });

            // Fetch reply message sender
            const { data: replySender } = await supabaseAdmin
              .from('users')
              .select('id, name')
              .eq('id', replyMsg.sender_id)
              .single();

            replyToMessage = {
              id: replyMsg.id,
              sender_id: replyMsg.sender_id,
              sender_name: replySender?.name || 'Unknown User',
              message: replyMsg.is_deleted ? 'Message deleted' : replyMsg.message,
              message_type: replyMsg.message_type,
              file_name: replyMsg.file_name,
              created_at: replyMsg.created_at
            };

            console.log('✅ Backend: Reply data prepared:', {
              sender_name: replyToMessage.sender_name,
              message_preview: replyToMessage.message?.substring(0, 50),
              message_type: replyToMessage.message_type
            });
          } else {
            console.log('⚠️ Backend: No reply message found for ID:', replyToId);
          }
        }

        console.log('💬 Socket message - User data:', {
          socketUserId: socket.user.id,
          socketUserName: socket.user.name,
          socketUserRole: socket.user.role,
          fetchedSenderId: sender?.id,
          fetchedSenderName: sender?.name,
          fetchedSenderRole: sender?.role,
          fetchedSenderEmail: sender?.email,
          hasReply: !!replyToMessage
        });

        // Use the fetched sender data if available, otherwise fall back to socket.user
        const userData = sender || {
          id: socket.user.id,
          name: socket.user.name,
          email: socket.user.email,
          profile_picture: socket.user.profile_picture,
          role: socket.user.role
        };

        console.log('💬 Final userData being sent:', userData);

        const messageWithSender = {
          ...newMessage,
          user: userData,
          sender: userData,
          message_mode: messageMode, // Include message mode in broadcast
          reply_to: replyToMessage, // Add reply information
          seen_by: [] // New messages haven't been seen by anyone yet
        };

        console.log('📤 Backend: Broadcasting message with reply_to:', {
          message_id: messageWithSender.id,
          has_reply: !!replyToMessage,
          reply_to_id: replyToMessage?.id,
          reply_sender: replyToMessage?.sender_name,
          full_reply_object: replyToMessage
        });

        // Broadcast message to all users in the ticket (including sender)
        // Frontend will filter messages based on user role and message_mode
        io.to(`ticket:${ticketId}`).emit('new_message', messageWithSender);

        // Create notifications for other ticket members
        // Only notify relevant users based on message_mode
        await createTicketMessageNotification(ticketId, socket.user.id, messageType, messageMode);

        // Send email notifications ONLY if sender is client or admin
        if (socket.user.role === 'client' || socket.user.role === 'admin') {
          console.log(`📧 Sending email notifications for message from ${socket.user.role}...`);

          try {
            // Get ticket details for email
            const { data: ticketData } = await supabaseAdmin
              .from('tickets')
              .select('id, title, ticket_number, uid')
              .eq('id', ticketId)
              .single();

            if (!ticketData) {
              console.error('❌ Ticket not found for email notification');
            } else {
              // Get all ticket members (excluding the sender)
              const { data: ticketMembers } = await supabaseAdmin
                .from('ticket_members')
                .select('user_id, users!ticket_members_user_id_fkey(id, email, name)')
                .eq('ticket_id', ticketId)
                .neq('user_id', socket.user.id); // Exclude sender

              // Also get all admins to ensure they are notified (even if not in ticket_members)
              // Only needed if sender is NOT an admin (i.e. if sender is client)
              let adminUsers = [];
              if (socket.user.role !== 'admin') {
                const { data: admins } = await supabaseAdmin
                  .from('users')
                  .select('id, email, name')
                  .eq('role', 'admin')
                  .eq('approval_status', 'approved')
                  .neq('id', socket.user.id); // Exclude sender if they happen to be admin (redundant check but safe)

                if (admins) {
                  adminUsers = admins;
                }
              }

              // Combine unique recipients
              const recipientsMap = new Map();

              // Add ticket members
              if (ticketMembers) {
                ticketMembers.forEach(member => {
                  if (member.users && member.users.email) {
                    recipientsMap.set(member.users.email, {
                      email: member.users.email,
                      name: member.users.name || 'User'
                    });
                  }
                });
              }

              // Add admins
              adminUsers.forEach(admin => {
                if (admin.email && !recipientsMap.has(admin.email)) {
                  recipientsMap.set(admin.email, {
                    email: admin.email,
                    name: admin.name || 'Admin'
                  });
                }
              });

              const recipientList = Array.from(recipientsMap.values());

              if (recipientList.length > 0) {
                console.log(`📧 Sending emails to ${recipientList.length} recipients (${ticketMembers?.length || 0} members + ${adminUsers.length} admins)...`);

                // Send email to each recipient
                const emailPromises = recipientList.map(async (recipient) => {
                  try {
                    const recipientEmail = recipient.email;
                    const recipientName = recipient.name;
                    const senderName = socket.user.name || socket.user.email;

                    await sendTicketMessageEmail(
                      recipientEmail,
                      recipientName,
                      ticketData,
                      senderName
                    );

                    console.log(`✅ Email sent to ${recipientEmail}`);
                  } catch (emailError) {
                    console.error(`❌ Failed to send email to ${recipient.email}:`, emailError.message);
                  }
                });

                await Promise.all(emailPromises);
                console.log(`✅ Completed sending ${recipientList.length} email notifications`);
              } else {
                console.log('ℹ️ No recipients to email');
              }
            }
          } catch (emailError) {
            console.error('❌ Error in email notification process:', emailError);
            // Don't fail the message send if email fails - log and continue
          }
        } else {
          console.log(`⏭️ Skipping email notifications - sender role is ${socket.user.role} (not client or admin)`);
        }

        // Update ticket's last_message_at timestamp (handled by trigger in database)

      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    /**
     * User is typing indicator for tickets
     * Client emits: { ticketId: 'uuid', isTyping: true/false }
     */
    socket.on('typing', (data) => {
      const { ticketId, isTyping } = data;

      // Broadcast to others in the ticket (not to sender)
      socket.to(`ticket:${ticketId}`).emit('user_typing', {
        userId: socket.user.id,
        userName: socket.user.name,
        ticketId,
        isTyping
      });
    });

    /**
     * Mark messages as read/seen in a ticket
     * Client emits: { ticketId: 'uuid', messageIds: ['uuid1', 'uuid2'] }
     * Broadcasts: message_seen event with user details
     */
    socket.on('mark_as_read', async (data) => {
      try {
        const { ticketId, messageIds } = data;

        if (!messageIds || messageIds.length === 0) {
          return;
        }

        console.log(`👁️ User ${socket.user.email} marking ${messageIds.length} messages as seen in ticket ${ticketId}`);

        // Update messages as read (legacy support)
        const { error: updateError } = await supabaseAdmin
          .from('ticket_messages')
          .update({ is_read: true })
          .eq('ticket_id', ticketId)
          .in('id', messageIds);

        if (updateError) {
          console.error('Error updating is_read:', updateError);
        }

        // Insert seen records for each message (upsert to avoid duplicates)
        const seenRecords = messageIds.map(messageId => ({
          message_id: messageId,
          user_id: socket.user.id,
          seen_at: new Date().toISOString()
        }));

        const { error: seenError } = await supabaseAdmin
          .from('message_seen_by')
          .upsert(seenRecords, {
            onConflict: 'message_id,user_id',
            ignoreDuplicates: true
          });

        if (seenError) {
          console.error('Error inserting seen records:', seenError);
          // Don't return - still broadcast the event
        }

        // Broadcast seen status to others in the ticket
        socket.to(`ticket:${ticketId}`).emit('message_seen', {
          userId: socket.user.id,
          userName: socket.user.name,
          userRole: socket.user.role,
          messageIds,
          ticketId,
          seenAt: new Date().toISOString()
        });

        // Also emit legacy event for backwards compatibility
        socket.to(`ticket:${ticketId}`).emit('messages_read', {
          userId: socket.user.id,
          messageIds,
          ticketId
        });

        console.log(`✅ Messages marked as seen by ${socket.user.name}`);

      } catch (error) {
        console.error('Error in mark_as_read:', error);
      }
    });

    /**
     * Edit a message in a ticket
     * Client emits: { ticketId: 'uuid', messageId: 'uuid', message: 'new text' }
     */
    socket.on('edit_message', async (data) => {
      try {
        const { ticketId, messageId, message } = data;

        console.log('✏️ Edit message via socket:', { ticketId, messageId, userId: socket.user.id });

        // Get the message
        const { data: existingMessage, error: fetchError } = await supabaseAdmin
          .from('ticket_messages')
          .select('sender_id, message, is_deleted, message_type')
          .eq('id', messageId)
          .eq('ticket_id', ticketId)
          .single();

        if (fetchError || !existingMessage) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        // Check permissions
        if (existingMessage.sender_id !== socket.user.id) {
          socket.emit('error', { message: 'You can only edit your own messages' });
          return;
        }

        if (existingMessage.is_deleted) {
          socket.emit('error', { message: 'Cannot edit deleted message' });
          return;
        }

        if (existingMessage.message_type !== 'text') {
          socket.emit('error', { message: 'Only text messages can be edited' });
          return;
        }

        // Save to history
        await supabaseAdmin
          .from('ticket_message_history')
          .insert([{
            message_id: messageId,
            action: 'edit',
            previous_content: existingMessage.message,
            performed_by: socket.user.id
          }]);

        // Update the message
        const { data: updatedMessage, error: updateError } = await supabaseAdmin
          .from('ticket_messages')
          .update({
            message: message.trim(),
            is_edited: true,
            updated_at: new Date().toISOString()
          })
          .eq('id', messageId)
          .select('*')
          .single();

        if (updateError) {
          socket.emit('error', { message: 'Failed to update message' });
          return;
        }

        // Fetch sender details
        const { data: sender } = await supabaseAdmin
          .from('users')
          .select('id, email, name, profile_picture, role')
          .eq('id', socket.user.id)
          .single();

        const messageWithSender = {
          ...updatedMessage,
          user: sender || socket.user,
          sender: sender || socket.user
        };

        // Broadcast to all users in the ticket
        io.to(`ticket:${ticketId}`).emit('message_edited', messageWithSender);

        console.log('✅ Message edited and broadcasted');

      } catch (error) {
        console.error('Error editing message:', error);
        socket.emit('error', { message: 'Failed to edit message' });
      }
    });

    /**
     * Delete a message in a ticket
     * Client emits: { ticketId: 'uuid', messageId: 'uuid' }
     */
    socket.on('delete_message', async (data) => {
      try {
        const { ticketId, messageId } = data;

        console.log('🗑️ Delete message via socket:', { ticketId, messageId, userId: socket.user.id });

        // Get the message
        const { data: existingMessage, error: fetchError } = await supabaseAdmin
          .from('ticket_messages')
          .select('sender_id, message, is_deleted')
          .eq('id', messageId)
          .eq('ticket_id', ticketId)
          .single();

        if (fetchError || !existingMessage) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        if (existingMessage.is_deleted) {
          socket.emit('error', { message: 'Message already deleted' });
          return;
        }

        // Check permissions: sender can delete own messages, admins can delete ANY message
        const isMessageOwner = existingMessage.sender_id === socket.user.id;
        const isAdmin = socket.user.role === 'admin';

        console.log('🔐 Delete permission check:', {
          userId: socket.user.id,
          userRole: socket.user.role,
          messageSenderId: existingMessage.sender_id,
          isMessageOwner,
          isAdmin,
          canDelete: isMessageOwner || isAdmin
        });

        if (!isMessageOwner && !isAdmin) {
          socket.emit('error', { message: 'You can only delete your own messages. Admins can delete any message.' });
          return;
        }

        // Save to history
        await supabaseAdmin
          .from('ticket_message_history')
          .insert([{
            message_id: messageId,
            action: 'delete',
            previous_content: existingMessage.message,
            performed_by: socket.user.id
          }]);

        // Soft delete
        const { data: deletedMessage, error: deleteError } = await supabaseAdmin
          .from('ticket_messages')
          .update({
            is_deleted: true,
            deleted_at: new Date().toISOString(),
            deleted_by: socket.user.id,
            message: existingMessage.sender_id === socket.user.id ? 'You deleted this message' : 'This message was deleted',
            file_url: null
          })
          .eq('id', messageId)
          .select('*')
          .single();

        if (deleteError) {
          socket.emit('error', { message: 'Failed to delete message' });
          return;
        }

        // Fetch sender details
        const { data: sender } = await supabaseAdmin
          .from('users')
          .select('id, email, name, profile_picture, role')
          .eq('id', existingMessage.sender_id)
          .single();

        const messageWithSender = {
          ...deletedMessage,
          user: sender || socket.user,
          sender: sender || socket.user
        };

        // Broadcast to all users in the ticket
        io.to(`ticket:${ticketId}`).emit('message_deleted', messageWithSender);

        console.log('✅ Message deleted and broadcasted');

      } catch (error) {
        console.error('Error deleting message:', error);
        socket.emit('error', { message: 'Failed to delete message' });
      }
    });

    /**
     * Forward a message to another ticket
     * Client emits: { sourceTicketId: 'uuid', targetTicketId: 'uuid', messageId: 'uuid', messageMode: 'client'|'internal' }
     */
    socket.on('forward_message', async (data) => {
      try {
        // Frontend might send messageTarget or messageMode
        const { sourceTicketId, targetTicketId, messageId, messageTarget, messageMode } = data;

        // Use messageTarget if provided, otherwise messageMode, default to 'client'
        const finalMessageMode = messageTarget || messageMode || 'client';

        console.log('📨 Forward message via socket:', {
          sourceTicketId,
          targetTicketId,
          messageId,
          messageTarget,
          messageMode,
          finalMessageMode,
          userId: socket.user.id,
          userRole: socket.user.role
        });

        // Validate message mode
        if (!['client', 'internal'].includes(finalMessageMode)) {
          socket.emit('error', { message: 'Invalid message mode. Must be "client" or "internal"' });
          return;
        }

        // Get the original message
        const { data: originalMessage, error: fetchError } = await supabaseAdmin
          .from('ticket_messages')
          .select(`
            *,
            sender:users!ticket_messages_sender_id_fkey (
              id,
              name,
              email,
              profile_picture,
              role
            )
          `)
          .eq('id', messageId)
          .eq('ticket_id', sourceTicketId)
          .single();

        if (fetchError || !originalMessage) {
          socket.emit('error', { message: 'Original message not found' });
          return;
        }

        if (originalMessage.is_deleted) {
          socket.emit('error', { message: 'Cannot forward deleted message' });
          return;
        }

        // Get source ticket details for metadata
        const { data: sourceTicket } = await supabaseAdmin
          .from('tickets')
          .select('id, ticket_number, title')
          .eq('id', sourceTicketId)
          .single();

        if (!sourceTicket) {
          socket.emit('error', { message: 'Source ticket not found' });
          return;
        }

        // Check if user is member of source ticket
        const { data: sourceMembership } = await supabaseAdmin
          .from('ticket_members')
          .select('*')
          .eq('ticket_id', sourceTicketId)
          .eq('user_id', socket.user.id)
          .single();

        if (!sourceMembership) {
          socket.emit('error', { message: 'You are not a member of the source ticket' });
          return;
        }

        // Check if user is member of target ticket
        const { data: targetMembership } = await supabaseAdmin
          .from('ticket_members')
          .select('*')
          .eq('ticket_id', targetTicketId)
          .eq('user_id', socket.user.id)
          .single();

        if (!targetMembership) {
          socket.emit('error', { message: 'You are not a member of the target ticket' });
          return;
        }

        // Check permissions: Only clients cannot forward to internal mode
        if (socket.user.role === 'client' && finalMessageMode === 'internal') {
          socket.emit('error', { message: 'You cannot forward messages to internal mode' });
          return;
        }

        // Copy ORIGINAL message content EXACTLY (don't modify it)
        // Create the forwarded message with all original fields preserved
        const { data: forwardedMessage, error: insertError } = await supabaseAdmin
          .from('ticket_messages')
          .insert([{
            ticket_id: targetTicketId,
            sender_id: socket.user.id, // Current user who is forwarding
            message: originalMessage.message, // ORIGINAL message content unchanged
            message_type: originalMessage.message_type, // ORIGINAL type (text, image, video, etc.)
            message_mode: finalMessageMode, // Based on messageTarget from frontend
            file_url: originalMessage.file_url, // ORIGINAL file_url if media
            file_name: originalMessage.file_name,
            file_size: originalMessage.file_size,
            file_mime_type: originalMessage.file_mime_type,
            forwarded_from_message_id: originalMessage.id,
            forwarded_from_ticket_id: sourceTicketId
          }])
          .select('*')
          .single();

        if (insertError) {
          console.error('Error creating forwarded message:', insertError);
          socket.emit('error', { message: 'Failed to forward message' });
          return;
        }

        console.log('✅ Forwarded message created with mode:', forwardedMessage.message_mode);

        // Fetch current user details (the one forwarding)
        const { data: currentUser } = await supabaseAdmin
          .from('users')
          .select('id, email, name, profile_picture, role')
          .eq('id', socket.user.id)
          .single();

        const messageWithSender = {
          ...forwardedMessage,
          user: currentUser || socket.user, // Person who forwarded it
          sender: currentUser || socket.user, // Person who forwarded it
          // Add forwarded metadata in multiple formats for frontend compatibility
          forwarded_from: {
            ticketId: sourceTicket.id,
            ticketNumber: sourceTicket.ticket_number,
            ticketTitle: sourceTicket.title,
            originalSender: originalMessage.sender // Original message author
          },
          forwardedFrom: {  // camelCase version
            ticketId: sourceTicket.id,
            ticketNumber: sourceTicket.ticket_number,
            ticketTitle: sourceTicket.title,
            originalSender: originalMessage.sender
          },
          isForwarded: true  // Simple boolean flag
        };

        console.log('🔄 FORWARDED MESSAGE DETECTED - Sending to frontend:');
        console.log('Message ID:', messageWithSender.id);
        console.log('Message Type:', messageWithSender.message_type);
        console.log('Message Mode:', messageWithSender.message_mode);
        console.log('forwarded_from_message_id:', messageWithSender.forwarded_from_message_id);
        console.log('forwarded_from_ticket_id:', messageWithSender.forwarded_from_ticket_id);
        console.log('isForwarded:', messageWithSender.isForwarded);
        console.log('forwarded_from object:', JSON.stringify(messageWithSender.forwarded_from, null, 2));
        console.log('forwardedFrom object:', JSON.stringify(messageWithSender.forwardedFrom, null, 2));
        console.log('Full message object keys:', Object.keys(messageWithSender));

        // Broadcast to target ticket room
        io.to(`ticket:${targetTicketId}`).emit('new_message', messageWithSender);

        // Confirm to sender
        socket.emit('message_forwarded', {
          originalMessageId: messageId,
          forwardedMessageId: forwardedMessage.id,
          targetTicketId
        });

        console.log('✅ Message forwarded successfully');

      } catch (error) {
        console.error('Error forwarding message:', error);
        socket.emit('error', { message: 'Failed to forward message' });
      }
    });

    /**
     * Notify works update to ticket members
     * Client emits: { ticketId: 'uuid', points: [], memberIds: [] }
     */
    socket.on('notify_works_update', (data) => {
      try {
        const { ticketId, points, memberIds } = data;

        console.log('📝 Broadcasting works update:', { ticketId, pointsCount: points.length, memberCount: memberIds.length });

        // Broadcast to all users in the ticket
        io.to(`ticket:${ticketId}`).emit('works_updated', {
          ticketId,
          points,
          updatedBy: socket.user.name
        });

      } catch (error) {
        console.error('Error broadcasting works update:', error);
      }
    });

    /**
     * Get online users in a ticket
     * Client emits: { ticketId: 'uuid' }
     */
    socket.on('get_online_users', async (data) => {
      try {
        const { ticketId } = data;

        // Get all sockets in this ticket room
        const socketsInRoom = await io.in(`ticket:${ticketId}`).fetchSockets();

        // Extract unique user IDs
        const onlineUserIds = [...new Set(socketsInRoom.map(s => s.user.id))];

        socket.emit('online_users', {
          ticketId,
          userIds: onlineUserIds
        });
      } catch (error) {
        console.error('Error getting online users:', error);
      }
    });

    /**
     * Join a chat group room
     * Client emits: { groupId: 'uuid' }
     */
    socket.on('join_group', async (data) => {
      try {
        const { groupId } = data;

        console.log(`🎯 join_group attempt: userId=${socket.user.id}, groupId=${groupId}, role=${socket.user.role}`);

        // Verify user is a member of this group
        const { data: membership, error } = await supabaseAdmin
          .from('chat_members')
          .select('*')
          .eq('chat_group_id', groupId)
          .eq('user_id', socket.user.id)
          .single();

        if (error) {
          console.error(`❌ Error checking group membership:`, error);
        }

        if (error || !membership) {
          console.log(`❌ User ${socket.user.email} not authorized for group ${groupId}`);
          console.log(`💡 HINT: Frontend might be calling 'join_group' instead of 'join_ticket'. Check if groupId is actually a ticketId.`);
          socket.emit('error', {
            message: 'You are not a member of this group',
            hint: 'If you are trying to join a ticket, use join_ticket event instead',
            groupId: groupId,
            userId: socket.user.id
          });
          return;
        }

        // Join the group room
        socket.join(`group:${groupId}`);
        console.log(`User ${socket.user.email} joined group ${groupId}`);

        // Notify others in the group
        socket.to(`group:${groupId}`).emit('user_joined', {
          userId: socket.user.id,
          userName: socket.user.name,
          groupId
        });

        // Send confirmation to user
        socket.emit('joined_group', { groupId });
      } catch (error) {
        console.error('Error joining group:', error);
        socket.emit('error', { message: 'Failed to join group' });
      }
    });

    /**
     * Leave a chat group room
     * Client emits: { groupId: 'uuid' }
     */
    socket.on('leave_group', (data) => {
      const { groupId } = data;
      socket.leave(`group:${groupId}`);

      // Notify others in the group
      socket.to(`group:${groupId}`).emit('user_left', {
        userId: socket.user.id,
        userName: socket.user.name,
        groupId
      });

      console.log(`User ${socket.user.email} left group ${groupId}`);
    });

    /**
     * Send a message to a group
     * Client emits: { groupId: 'uuid', message: 'text', messageType: 'text' }
     */
    socket.on('send_message', async (data) => {
      try {
        const { groupId, message, messageType = 'text', fileUrl = null } = data;

        // Verify user is a member
        const { data: membership } = await supabaseAdmin
          .from('chat_members')
          .select('*')
          .eq('chat_group_id', groupId)
          .eq('user_id', socket.user.id)
          .single();

        if (!membership) {
          socket.emit('error', { message: 'You are not a member of this group' });
          return;
        }

        // Save message to database
        const { data: newMessage, error } = await supabaseAdmin
          .from('chat_messages')
          .insert([{
            chat_group_id: groupId,
            sender_id: socket.user.id,
            message,
            message_type: messageType,
            file_url: fileUrl,
            is_read: false
          }])
          .select(`
            *,
            sender:users!chat_messages_sender_id_fkey (
              id,
              email,
              name,
              profile_picture
            )
          `)
          .single();

        if (error) {
          console.error('Error saving message:', error);
          socket.emit('error', { message: 'Failed to send message' });
          return;
        }

        // Broadcast message to all users in the group (including sender)
        io.to(`group:${groupId}`).emit('new_message', newMessage);

        // Update group's updated_at timestamp
        await supabaseAdmin
          .from('chat_groups')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', groupId);

      } catch (error) {
        console.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    /**
     * User is typing indicator
     * Client emits: { groupId: 'uuid', isTyping: true/false }
     */
    socket.on('typing', (data) => {
      const { groupId, isTyping } = data;

      // Broadcast to others in the group (not to sender)
      socket.to(`group:${groupId}`).emit('user_typing', {
        userId: socket.user.id,
        userName: socket.user.name,
        groupId,
        isTyping
      });
    });

    /**
     * Mark messages as read
     * Client emits: { groupId: 'uuid', messageIds: ['uuid1', 'uuid2'] }
     */
    socket.on('mark_as_read', async (data) => {
      try {
        const { groupId, messageIds } = data;

        if (!messageIds || messageIds.length === 0) {
          return;
        }

        // Update messages as read
        const { error } = await supabaseAdmin
          .from('chat_messages')
          .update({ is_read: true })
          .eq('chat_group_id', groupId)
          .in('id', messageIds);

        if (error) {
          console.error('Error marking messages as read:', error);
          return;
        }

        // Notify others in the group
        socket.to(`group:${groupId}`).emit('messages_read', {
          userId: socket.user.id,
          messageIds,
          groupId
        });

      } catch (error) {
        console.error('Error in mark_as_read:', error);
      }
    });

    /**
     * Get online users in a group
     * Client emits: { groupId: 'uuid' }
     */
    socket.on('get_online_users', async (data) => {
      try {
        const { groupId } = data;

        // Get all sockets in this group room
        const socketsInRoom = await io.in(`group:${groupId}`).fetchSockets();

        // Extract unique user IDs
        const onlineUserIds = [...new Set(socketsInRoom.map(s => s.user.id))];

        socket.emit('online_users', {
          groupId,
          userIds: onlineUserIds
        });
      } catch (error) {
        console.error('Error getting online users:', error);
      }
    });

    /**
     * Handle disconnection
     */
    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.user.email} (${socket.id})`);

      // Notify all groups this user was in
      socket.rooms.forEach((room) => {
        if (room.startsWith('group:')) {
          socket.to(room).emit('user_offline', {
            userId: socket.user.id,
            userName: socket.user.name
          });
        }
      });
    });

    /**
     * Handle errors
     */
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
};
