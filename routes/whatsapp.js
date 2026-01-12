/**
 * WhatsApp Routes
 * Handles WhatsApp messaging endpoints
 */

import express from "express";
import {
  sendMessage,
  sendTicketStatus,
  sendWelcome,
  testService,
  getStatus,
} from "../controllers/whatsappController.js";
import { authenticateToken } from "../middleware/auth.js";

const router = express.Router();

/**
 * @route   POST /api/whatsapp/send
 * @desc    Send WhatsApp message
 * @access  Private (Admin only)
 */
router.post("/send", authenticateToken, sendMessage);

/**
 * @route   POST /api/whatsapp/ticket-status
 * @desc    Send ticket status WhatsApp message
 * @access  Private (Admin only)
 */
router.post("/ticket-status", authenticateToken, sendTicketStatus);

/**
 * @route   POST /api/whatsapp/welcome
 * @desc    Send welcome WhatsApp message
 * @access  Private (Admin only)
 */
router.post("/welcome", authenticateToken, sendWelcome);

/**
 * @route   GET /api/whatsapp/test
 * @desc    Test WhatsApp service configuration
 * @access  Private (Admin only)
 */
router.get("/test", authenticateToken, testService);

/**
 * @route   GET /api/whatsapp/status
 * @desc    Get WhatsApp service status
 * @access  Private (Admin only)
 */
router.get("/status", authenticateToken, getStatus);

export default router;
