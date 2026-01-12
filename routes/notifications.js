import express from 'express';
import {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadCount,
  deleteNotification,
  getNotificationPreferences,
  updateNotificationPreferences,
  notifyAdminsOfNewClient
} from '../controllers/notificationController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * @route   POST /api/notifications/new-client-registration
 * @desc    Notify admins of new client registration (called by Vercel)
 * @access  Public (internal API call from Vercel)
 */
router.post('/new-client-registration', notifyAdminsOfNewClient);

/**
 * @route   GET /api/notifications
 * @desc    Get notifications for current user
 * @access  Private
 */
router.get('/', authenticateToken, getNotifications);

/**
 * @route   GET /api/notifications/unread-count
 * @desc    Get unread notification count
 * @access  Private
 */
router.get('/unread-count', authenticateToken, getUnreadCount);

/**
 * @route   GET /api/notifications/preferences
 * @desc    Get user notification preferences
 * @access  Private
 */
router.get('/preferences', authenticateToken, getNotificationPreferences);

/**
 * @route   PUT /api/notifications/preferences
 * @desc    Update user notification preferences
 * @access  Private
 */
router.put('/preferences', authenticateToken, updateNotificationPreferences);

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all', authenticateToken, markAllNotificationsAsRead);

/**
 * @route   PUT /api/notifications/:notificationId/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:notificationId/read', authenticateToken, markNotificationAsRead);

/**
 * @route   DELETE /api/notifications/:notificationId
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:notificationId', authenticateToken, deleteNotification);

export default router;
