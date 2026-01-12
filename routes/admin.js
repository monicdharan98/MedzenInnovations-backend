import express from 'express';
import {
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
  starUser,
  unstarUser,
  getStarredUsers
} from '../controllers/adminController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticateToken);

/**
 * @route   GET /api/admin/users
 * @desc    Get all approved users (for adding to tickets)
 * @access  Admin and Employee
 */
router.get('/users', requireRole(['admin', 'employee']), getAllUsers);

/**
 * @route   GET /api/admin/users/:userId/tickets
 * @desc    Get all tickets for a specific user
 * @access  Admin and Employee
 */
router.get('/users/:userId/tickets', requireRole(['admin', 'employee']), getUserTickets);

// All other routes require admin role only
router.use(requireRole('admin'));

/**
 * @route   GET /api/admin/pending-users
 * @desc    Get all users pending approval
 * @access  Admin only
 */
router.get('/pending-users', getPendingUsers);

/**
 * @route   GET /api/admin/approved-users
 * @desc    Get all approved users
 * @access  Admin only
 */
router.get('/approved-users', getApprovedUsers);

/**
 * @route   POST /api/admin/approve-user
 * @desc    Approve a pending user
 * @access  Admin only
 */
router.post('/approve-user', approveUser);

/**
 * @route   POST /api/admin/reject-user
 * @desc    Reject a pending user
 * @access  Admin only
 */
router.post('/reject-user', rejectUser);

/**
 * @route   GET /api/admin/stats
 * @desc    Get admin dashboard statistics
 * @access  Admin only
 */
router.get('/stats', getAdminStats);

/**
 * @route   PUT /api/admin/users/:userId/email
 * @desc    Update user email address
 * @access  Admin only
 */
router.put('/users/:userId/email', updateUserEmail);

/**
 * @route   POST /api/admin/send-user-otp
 * @desc    Send OTP to new user's email
 * @access  Admin only
 */
router.post('/send-user-otp', sendUserOTP);

/**
 * @route   POST /api/admin/add-user
 * @desc    Add new user with OTP verification
 * @access  Admin only
 */
router.post('/add-user', addUser);

/**
 * @route   POST /api/admin/create-user-simple
 * @desc    Create new user with just email and role (simplified - no OTP)
 * @access  Admin only
 */
router.post('/create-user-simple', createUserSimple);

/**
 * @route   DELETE /api/admin/users/:userId
 * @desc    Delete a user and remove from all tickets
 * @access  Admin only
 */
router.delete('/users/:userId', deleteUser);

/**
 * @route   POST /api/admin/create-ticket-invite
 * @desc    Create one-time invite link for a ticket
 * @access  Admin only
 */
router.post('/create-ticket-invite', createTicketInvite);

/**
 * @route   POST /api/admin/send-email-change-otp
 * @desc    Send OTP to user's current email for email change verification
 * @access  Admin only
 */
router.post('/send-email-change-otp', sendEmailChangeOTP);

/**
 * @route   POST /api/admin/verify-email-change-otp
 * @desc    Verify OTP and change user email
 * @access  Admin only
 */
router.post('/verify-email-change-otp', verifyEmailChangeOTP);

/**
 * @route   POST /api/admin/users/:userId/star
 * @desc    Star/favorite a user
 * @access  Admin only
 */
router.post('/users/:userId/star', starUser);

/**
 * @route   DELETE /api/admin/users/:userId/star
 * @desc    Unstar/unfavorite a user
 * @access  Admin only
 */
router.delete('/users/:userId/star', unstarUser);

/**
 * @route   GET /api/admin/starred-users
 * @desc    Get all starred users
 * @access  Admin only
 */
router.get('/starred-users', getStarredUsers);

export default router;
