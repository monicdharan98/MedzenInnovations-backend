/**
 * WhatsApp Controller
 * Handles WhatsApp-related API endpoints
 */

import {
  sendWhatsAppMessage,
  sendTicketStatusWhatsApp,
  sendWelcomeWhatsApp,
  testWhatsAppService,
} from "../utils/whatsappService.js";
import {
  successResponse,
  errorResponse,
  validationError,
} from "../utils/responses.js";

/**
 * Send WhatsApp message
 * POST /api/whatsapp/send
 */
export const sendMessage = async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;

    // Validation
    if (!phoneNumber || !message) {
      return validationError(res, {
        field: "Phone number and message are required",
      });
    }

    console.log("📱 WhatsApp send message request:", {
      phoneNumber: phoneNumber.replace(/\d(?=\d{4})/g, "*"), // Mask for logging
      messageLength: message.length,
      requestedBy: req.user?.email || "Unknown",
    });

    // Send WhatsApp message
    const result = await sendWhatsAppMessage(phoneNumber, message);

    if (result.success) {
      return successResponse(
        res,
        {
          phoneNumber: result.phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
          messageId: result.data?.messageId,
          status: result.data?.status,
          sent: true,
        },
        "WhatsApp message sent successfully"
      );
    } else {
      return errorResponse(
        res,
        `Failed to send WhatsApp message: ${result.error}`,
        500,
        {
          phoneNumber: result.phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
          error: result.error,
          sent: false,
        }
      );
    }
  } catch (error) {
    console.error("Send WhatsApp message error:", error);
    return errorResponse(res, "Failed to send WhatsApp message", 500);
  }
};

/**
 * Send ticket status WhatsApp message
 * POST /api/whatsapp/ticket-status
 */
export const sendTicketStatus = async (req, res) => {
  try {
    const { phoneNumber, ticketInfo, status } = req.body;

    // Validation
    if (!phoneNumber || !ticketInfo || !status) {
      return validationError(res, {
        field: "Phone number, ticket info, and status are required",
      });
    }

    console.log("📱 WhatsApp ticket status request:", {
      phoneNumber: phoneNumber.replace(/\d(?=\d{4})/g, "*"),
      ticketNumber: ticketInfo.ticketNumber,
      status,
      requestedBy: req.user?.email || "Unknown",
    });

    // Send ticket status WhatsApp message
    const result = await sendTicketStatusWhatsApp(
      phoneNumber,
      ticketInfo,
      status
    );

    if (result.success) {
      return successResponse(
        res,
        {
          phoneNumber: result.phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
          ticketNumber: ticketInfo.ticketNumber,
          status,
          messageId: result.data?.messageId,
          sent: true,
        },
        "Ticket status WhatsApp message sent successfully"
      );
    } else {
      return errorResponse(
        res,
        `Failed to send ticket status WhatsApp: ${result.error}`,
        500,
        {
          phoneNumber: result.phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
          error: result.error,
          sent: false,
        }
      );
    }
  } catch (error) {
    console.error("Send ticket status WhatsApp error:", error);
    return errorResponse(res, "Failed to send ticket status WhatsApp", 500);
  }
};

/**
 * Send welcome WhatsApp message
 * POST /api/whatsapp/welcome
 */
export const sendWelcome = async (req, res) => {
  try {
    const { phoneNumber, clientName } = req.body;

    // Validation
    if (!phoneNumber) {
      return validationError(res, {
        field: "Phone number is required",
      });
    }

    console.log("📱 WhatsApp welcome message request:", {
      phoneNumber: phoneNumber.replace(/\d(?=\d{4})/g, "*"),
      clientName: clientName || "Unknown",
      requestedBy: req.user?.email || "Unknown",
    });

    // Send welcome WhatsApp message
    const result = await sendWelcomeWhatsApp(phoneNumber, clientName);

    if (result.success) {
      return successResponse(
        res,
        {
          phoneNumber: result.phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
          clientName,
          messageId: result.data?.messageId,
          sent: true,
        },
        "Welcome WhatsApp message sent successfully"
      );
    } else {
      return errorResponse(
        res,
        `Failed to send welcome WhatsApp: ${result.error}`,
        500,
        {
          phoneNumber: result.phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
          error: result.error,
          sent: false,
        }
      );
    }
  } catch (error) {
    console.error("Send welcome WhatsApp error:", error);
    return errorResponse(res, "Failed to send welcome WhatsApp", 500);
  }
};

/**
 * Test WhatsApp service configuration
 * GET /api/whatsapp/test
 */
export const testService = async (req, res) => {
  try {
    console.log(
      "🧪 WhatsApp service test requested by:",
      req.user?.email || "Unknown"
    );

    const result = await testWhatsAppService();

    if (result.success) {
      return successResponse(
        res,
        {
          configured: true,
          config: result.config,
          message: result.message,
        },
        "WhatsApp service is properly configured"
      );
    } else {
      return errorResponse(res, result.error, 400, {
        configured: false,
        config: result.config,
        message: result.message,
      });
    }
  } catch (error) {
    console.error("Test WhatsApp service error:", error);
    return errorResponse(res, "Failed to test WhatsApp service", 500);
  }
};

/**
 * Get WhatsApp service status
 * GET /api/whatsapp/status
 */
export const getStatus = async (req, res) => {
  try {
    const status = {
      configured: !!(
        process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_API_BASE_URL
      ),
      baseUrl: process.env.WHATSAPP_API_BASE_URL || "Not configured",
      hasToken: !!process.env.WHATSAPP_API_TOKEN,
      tokenLength: process.env.WHATSAPP_API_TOKEN?.length || 0,
      lastChecked: new Date().toISOString(),
    };

    return successResponse(
      res,
      status,
      "WhatsApp service status retrieved successfully"
    );
  } catch (error) {
    console.error("Get WhatsApp status error:", error);
    return errorResponse(res, "Failed to get WhatsApp status", 500);
  }
};

export default {
  sendMessage,
  sendTicketStatus,
  sendWelcome,
  testService,
  getStatus,
};
