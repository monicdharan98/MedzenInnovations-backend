import { supabaseAdmin } from '../config/supabase.js';
import { successResponse, errorResponse } from '../utils/responses.js';

/**
 * Get notifications for current user
 * GET /api/notifications
 */
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { unreadOnly } = req.query;

    if (!userId) {
      console.error('No user ID found in request');
      return errorResponse(res, 'User not authenticated', 401);
    }

    let query = supabaseAdmin
      .from('notifications')
      .select(`
        *,
        related_user:users!notifications_related_user_id_fkey (id, name, email, role, profile_picture),
        related_ticket:tickets (id, ticket_number, title)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (unreadOnly === 'true') {
      query = query.eq('is_read', false);
    }

    const { data: notifications, error } = await query;

    if (error) {
      console.error('Error fetching notifications:', error);
      return errorResponse(res, 'Failed to fetch notifications', 500);
    }

    return successResponse(res, { notifications: notifications || [] }, 'Notifications fetched successfully');
  } catch (error) {
    console.error('Get notifications error:', error);
    return errorResponse(res, 'Failed to fetch notifications', 500);
  }
};

/**
 * Mark notification as read
 * PUT /api/notifications/:notificationId/read
 */
export const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      console.error('No user ID found in request');
      return errorResponse(res, 'User not authenticated', 401);
    }

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error marking notification as read:', error);
      return errorResponse(res, 'Failed to mark notification as read', 500);
    }

    return successResponse(res, {}, 'Notification marked as read');
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return errorResponse(res, 'Failed to mark notification as read', 500);
  }
};

/**
 * Mark all notifications as read
 * PUT /api/notifications/read-all
 */
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      console.error('No user ID found in request');
      return errorResponse(res, 'User not authenticated', 401);
    }

    const { error } = await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error marking all notifications as read:', error);
      return errorResponse(res, 'Failed to mark all notifications as read', 500);
    }

    return successResponse(res, {}, 'All notifications marked as read');
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    return errorResponse(res, 'Failed to mark all notifications as read', 500);
  }
};

/**
 * Get unread notification count
 * GET /api/notifications/unread-count
 */
export const getUnreadCount = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      console.error('No user ID found in request');
      return errorResponse(res, 'User not authenticated', 401);
    }

    const { count, error } = await supabaseAdmin
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Error getting unread count:', error);
      return errorResponse(res, 'Failed to get unread count', 500);
    }

    return successResponse(res, { count: count || 0 }, 'Unread count fetched successfully');
  } catch (error) {
    console.error('Get unread count error:', error);
    return errorResponse(res, 'Failed to get unread count', 500);
  }
};

/**
 * Delete notification
 * DELETE /api/notifications/:notificationId
 */
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      console.error('No user ID found in request');
      return errorResponse(res, 'User not authenticated', 401);
    }

    const { error } = await supabaseAdmin
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', userId);

    if (error) {
      console.error('Error deleting notification:', error);
      return errorResponse(res, 'Failed to delete notification', 500);
    }

    return successResponse(res, {}, 'Notification deleted successfully');
  } catch (error) {
    console.error('Delete notification error:', error);
    return errorResponse(res, 'Failed to delete notification', 500);
  }
};

/**
 * Get user notification preferences
 * GET /api/notifications/preferences
 */
export const getNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return errorResponse(res, 'User not authenticated', 401);
    }

    // Get user preferences
    const { data: preferences, error } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error fetching notification preferences:', error);
      return errorResponse(res, 'Failed to fetch notification preferences', 500);
    }

    // Return defaults if no preferences exist
    const defaultPreferences = {
      chat_clients: true,
      chat_internal: true,
      status_change: true,
      ticket_creation: true,
      ticket_assigned: true
    };

    return successResponse(
      res,
      preferences || defaultPreferences,
      'Notification preferences fetched successfully'
    );
  } catch (error) {
    console.error('Get notification preferences error:', error);
    return errorResponse(res, 'Failed to fetch notification preferences', 500);
  }
};

/**
 * Update user notification preferences
 * PUT /api/notifications/preferences
 */
export const updateNotificationPreferences = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { chat_clients, chat_internal, status_change, ticket_creation, ticket_assigned } = req.body;

    if (!userId) {
      return errorResponse(res, 'User not authenticated', 401);
    }

    // Validate all required fields are present
    if (
      typeof chat_clients !== 'boolean' ||
      typeof chat_internal !== 'boolean' ||
      typeof status_change !== 'boolean' ||
      typeof ticket_creation !== 'boolean' ||
      typeof ticket_assigned !== 'boolean'
    ) {
      return errorResponse(res, 'All preference fields are required and must be boolean', 400);
    }

    // Upsert preferences (insert or update)
    const { data, error } = await supabaseAdmin
      .from('notification_preferences')
      .upsert({
        user_id: userId,
        chat_clients,
        chat_internal,
        status_change,
        ticket_creation,
        ticket_assigned,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select()
      .single();

    if (error) {
      console.error('Error updating notification preferences:', error);
      return errorResponse(res, 'Failed to update notification preferences', 500);
    }

    return successResponse(
      res,
      data,
      'Notification preferences updated successfully'
    );
  } catch (error) {
    console.error('Update notification preferences error:', error);
    return errorResponse(res, 'Failed to update notification preferences', 500);
  }
};

/**
 * Notify admins of new client registration
 * POST /api/notifications/new-client-registration
 * Called by Vercel after client completes OTP verification
 */
export const notifyAdminsOfNewClient = async (req, res) => {
  try {
    const { userId, email, phone } = req.body;

    console.log('📢 New client registration notification request:', { userId, email, phone });

    if (!userId) {
      return errorResponse(res, 'User ID is required', 400);
    }

    // Get all admin users
    const { data: admins, error: adminError } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('role', 'admin')
      .eq('status', 'approved');

    if (adminError) {
      console.error('Error fetching admins:', adminError);
      return errorResponse(res, 'Failed to fetch admins', 500);
    }

    if (!admins || admins.length === 0) {
      console.log('⚠️ No admins found to notify');
      return successResponse(res, { notifiedAdmins: 0 }, 'No admins to notify');
    }

    // Create notification for each admin
    const notifications = admins.map((admin) => ({
      user_id: admin.id,
      type: 'new_client',
      title: 'New Client Registration',
      message: `A new client has registered: ${email || phone || 'Unknown'}`,
      related_user_id: userId,
      is_read: false,
      created_at: new Date().toISOString(),
    }));

    const { error: notifError } = await supabaseAdmin
      .from('notifications')
      .insert(notifications);

    if (notifError) {
      console.error('Error creating admin notifications:', notifError);
      return errorResponse(res, 'Failed to create notifications', 500);
    }

    console.log(`✅ Created ${admins.length} admin notification(s) for new client`);

    return successResponse(
      res,
      { notifiedAdmins: admins.length },
      'Admins notified successfully'
    );
  } catch (error) {
    console.error('notifyAdminsOfNewClient error:', error);
    return errorResponse(res, 'Failed to notify admins', 500);
  }
};

export default {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadCount,
  deleteNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
  notifyAdminsOfNewClient
};
