import express from "express";
import {
  createTicket,
  getUserTickets,
  getTicketDetails,
  addTicketMembers,
  addEmployeesToTicket,
  getAvailableEmployees,
  removeTicketMember,
  removeEmployeeFromTicket,
  updateMemberClientPermission,
  updateTicket,
  deleteTicket,
  getTicketMessages,
  addTicketMessage,
  updateTicketPoints,
  updateTicketStatus,
  updateTicketPriority,
  uploadTicketFile,
  generateUploadUrl,
  confirmUpload,
  updateMemberPermissions,
  starTicket,
  unstarTicket,
  checkTicketMembership,
  editMessage,
  deleteMessage,
  forwardMessage,
  exportTicketsToExcel,
  sendPaymentStageNotification,
  markPaymentStageCompleted,
} from "../controllers/ticketController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route   POST /api/tickets
 * @desc    Create a new ticket
 * @access  Private (Admin, Client)
 */
router.post("/", authenticateToken, createTicket);

/**
 * @route   GET /api/tickets
 * @desc    Get all tickets for current user
 * @access  Private
 */
router.get("/", authenticateToken, getUserTickets);

/**
 * @route   GET /api/tickets/export
 * @desc    Export all tickets to Excel file
 * @access  Private (Admin and Employee only)
 */
router.get("/export", authenticateToken, exportTicketsToExcel);

/**
 * IMPORTANT: Specific routes must come BEFORE generic :ticketId route
 * Otherwise Express will match /:ticketId first and return 404
 */

/**
 * @route   POST /api/tickets/:ticketId/upload-url
 * @desc    Generate signed URL for direct upload to Supabase (supports up to 50MB)
 * @access  Private
 */
router.post("/:ticketId/upload-url", authenticateToken, generateUploadUrl);

/**
 * @route   POST /api/tickets/:ticketId/upload-confirm
 * @desc    Confirm file upload after direct Supabase upload
 * @access  Private
 */
router.post("/:ticketId/upload-confirm", authenticateToken, confirmUpload);

/**
 * @route   POST /api/tickets/:ticketId/upload
 * @desc    Upload file for ticket message (Legacy - via Vercel, limited to 4.5MB)
 * @access  Private
 */
router.post("/:ticketId/upload", authenticateToken, uploadTicketFile);

/**
 * @route   POST /api/tickets/:ticketId/star
 * @desc    Star/Favorite a ticket
 * @access  Private
 */
router.post("/:ticketId/star", authenticateToken, starTicket);

/**
 * @route   POST /api/tickets/:ticketId/unstar
 * @desc    Unstar/Unfavorite a ticket
 * @access  Private
 */
router.post("/:ticketId/unstar", authenticateToken, unstarTicket);

/**
 * @route   POST /api/tickets/:ticketId/payment-stage/notify
 * @desc    Send payment stage notification to client via WhatsApp
 * @access  Private (Admin and Employee only)
 */
router.post(
  "/:ticketId/payment-stage/notify",
  authenticateToken,
  sendPaymentStageNotification
);

/**
 * @route   POST /api/tickets/:ticketId/payment-stage/complete
 * @desc    Mark payment stage as completed
 * @access  Private (Admin and Employee only)
 */
router.post(
  "/:ticketId/payment-stage/complete",
  authenticateToken,
  markPaymentStageCompleted
);

/**
 * @route   GET /api/tickets/:ticketId/membership
 * @desc    Check if current user is a member of the ticket
 * @access  Private
 * @note    Used for efficient polling after ticket creation
 */
router.get("/:ticketId/membership", authenticateToken, checkTicketMembership);

/**
 * @route   GET /api/tickets/:ticketId/messages
 * @desc    Get messages for a ticket
 * @access  Private
 */
router.get("/:ticketId/messages", authenticateToken, getTicketMessages);

/**
 * @route   POST /api/tickets/:ticketId/messages
 * @desc    Add message to ticket
 * @access  Private
 */
router.post("/:ticketId/messages", authenticateToken, addTicketMessage);

/**
 * @route   PUT /api/tickets/:ticketId/messages/:messageId
 * @desc    Edit a message
 * @access  Private (Own messages only)
 */
router.put("/:ticketId/messages/:messageId", authenticateToken, editMessage);

/**
 * @route   DELETE /api/tickets/:ticketId/messages/:messageId
 * @desc    Delete a message
 * @access  Private (Own messages or Admin)
 */
router.delete(
  "/:ticketId/messages/:messageId",
  authenticateToken,
  deleteMessage
);

/**
 * @route   POST /api/tickets/:ticketId/messages/:messageId/forward
 * @desc    Forward a message to another ticket
 * @access  Private
 */
router.post(
  "/:ticketId/messages/:messageId/forward",
  authenticateToken,
  forwardMessage
);

/**
 * @route   POST /api/tickets/:ticketId/members
 * @desc    Add members to ticket
 * @access  Private (Admin and Employee members)
 */
router.post("/:ticketId/members", authenticateToken, addTicketMembers);

/**
 * @route   POST /api/tickets/:ticketId/add-employees
 * @desc    Add employees to ticket (Employee-specific endpoint)
 * @access  Private (Admin and Employee members)
 */
router.post(
  "/:ticketId/add-employees",
  authenticateToken,
  addEmployeesToTicket
);

/**
 * @route   GET /api/tickets/:ticketId/available-employees
 * @desc    Get available employees that can be added to ticket
 * @access  Private (Admin and Employee members)
 */
router.get(
  "/:ticketId/available-employees",
  authenticateToken,
  getAvailableEmployees
);

/**
 * @route   DELETE /api/tickets/:ticketId/members/:userId
 * @desc    Remove a member from ticket
 * @access  Private (Admin and Employee members)
 */
router.delete(
  "/:ticketId/members/:userId",
  authenticateToken,
  removeTicketMember
);

/**
 * @route   DELETE /api/tickets/:ticketId/remove-employee/:userId
 * @desc    Remove employee from ticket (Employee-specific endpoint)
 * @access  Private (Admin and Employee members)
 */
router.delete(
  "/:ticketId/remove-employee/:userId",
  authenticateToken,
  removeEmployeeFromTicket
);

/**
 * @route   PUT /api/tickets/:ticketId/members/:memberId/client-permission
 * @desc    Update employee permission to message client
 * @access  Private (Admin only)
 */
router.put(
  "/:ticketId/members/:memberId/client-permission",
  authenticateToken,
  updateMemberClientPermission
);

/**
 * @route   PUT /api/tickets/:ticketId/members/:userId/permissions
 * @desc    Update employee permissions (can_message_client)
 * @access  Private (Admin only)
 */
router.put(
  "/:ticketId/members/:userId/permissions",
  authenticateToken,
  updateMemberPermissions
);

/**
 * @route   PUT /api/tickets/:id/points
 * @desc    Update ticket works/points
 * @access  Private (Admin only)
 */
router.put("/:id/points", authenticateToken, updateTicketPoints);

/**
 * @route   PUT /api/tickets/:id/status
 * @desc    Update ticket status
 * @access  Private (Admin or Employee Members)
 */
router.put("/:id/status", authenticateToken, updateTicketStatus);

/**
 * @route   PUT /api/tickets/:id/priority
 * @desc    Update ticket priority
 * @access  Private (Admin only)
 */
router.put("/:id/priority", authenticateToken, updateTicketPriority);

/**
 * Generic routes - MUST come last to avoid matching specific routes
 */

/**
 * @route   GET /api/tickets/:ticketId
 * @desc    Get ticket details
 * @access  Private
 */
router.get("/:ticketId", authenticateToken, getTicketDetails);

/**
 * @route   PUT /api/tickets/:ticketId
 * @desc    Update ticket
 * @access  Private (Admin only)
 */
router.put("/:ticketId", authenticateToken, updateTicket);

/**
 * @route   DELETE /api/tickets/:ticketId
 * @desc    Delete ticket
 * @access  Private (Admin only)
 */
router.delete("/:ticketId", authenticateToken, deleteTicket);

export default router;
