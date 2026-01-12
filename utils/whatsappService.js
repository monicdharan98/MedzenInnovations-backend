/**
 * WhatsApp Service
 * Handles WhatsApp messaging functionality
 */

import dotenv from "dotenv";

dotenv.config();

/**
 * Generic API call helper
 */
const apiCall = async (endpoint, options = {}) => {
  try {
    const baseUrl =
      process.env.WHATSAPP_API_BASE_URL || "https://api.whatsapp.com";
    const url = `${baseUrl}${endpoint}`;

    const defaultHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
    };

    const response = await fetch(url, {
      headers: { ...defaultHeaders, ...options.headers },
      ...options,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `WhatsApp API Error: ${data.error?.message || response.statusText}`
      );
    }

    return {
      success: true,
      data,
      status: response.status,
    };
  } catch (error) {
    console.error("WhatsApp API call failed:", error);
    return {
      success: false,
      error: error.message,
      status: error.status || 500,
    };
  }
};

/**
 * Send WhatsApp message
 * @param {string} phoneNumber - Phone number in international format (e.g., +1234567890)
 * @param {string} message - Message text to send
 * @returns {Promise<Object>} API response
 */
export const sendWhatsAppMessage = async (phoneNumber, message) => {
  try {
    console.log("📱 Sending WhatsApp message:", {
      phoneNumber: phoneNumber?.replace(/\d(?=\d{4})/g, "*"), // Mask phone number for logging
      messageLength: message?.length,
      timestamp: new Date().toISOString(),
    });

    // Validate inputs
    if (!phoneNumber || !message) {
      throw new Error("Phone number and message are required");
    }

    // Format phone number (remove any non-digit characters except +)
    const formattedPhone = phoneNumber.replace(/[^\d+]/g, "");

    // Ensure phone number starts with + for international format
    const internationalPhone = formattedPhone.startsWith("+")
      ? formattedPhone
      : `+${formattedPhone}`;

    // Check if WhatsApp API is configured
    if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_API_BASE_URL) {
      console.log(
        "⚠️ WhatsApp API not configured. Message would be sent to:",
        internationalPhone
      );
      console.log("📝 Message content:", message);
      return {
        success: false,
        error: "WhatsApp API not configured",
        message: "Message logged (WhatsApp not configured)",
        phoneNumber: internationalPhone,
        messageContent: message,
      };
    }

    // For Meta API, remove the + sign (they expect just digits)
    const metaPhoneNumber = internationalPhone.replace("+", "");

    // Prepare Meta WhatsApp Business API payload
    const payload = {
      messaging_product: "whatsapp",
      to: metaPhoneNumber,
      type: "text",
      text: {
        body: message,
      },
    };

    console.log("📤 Sending to Meta WhatsApp API:", {
      url: process.env.WHATSAPP_API_BASE_URL,
      to: metaPhoneNumber.replace(/\d(?=\d{4})/g, "*"),
      messageLength: message.length,
    });

    // Make direct API call to Meta WhatsApp Business API
    const response = await fetch(process.env.WHATSAPP_API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (response.ok) {
      console.log("✅ WhatsApp message sent successfully:", {
        phoneNumber: internationalPhone.replace(/\d(?=\d{4})/g, "*"),
        messageId: responseData.messages?.[0]?.id,
        status: responseData.messages?.[0]?.message_status,
      });

      return {
        success: true,
        data: {
          messageId: responseData.messages?.[0]?.id,
          status: responseData.messages?.[0]?.message_status,
          whatsappId: responseData.messages?.[0]?.wa_id,
        },
        phoneNumber: internationalPhone,
        status: response.status,
      };
    } else {
      console.error("❌ WhatsApp API error:", {
        status: response.status,
        error: responseData.error,
        details: responseData,
      });

      return {
        success: false,
        error: responseData.error?.message || `API Error: ${response.status}`,
        details: responseData,
        phoneNumber: internationalPhone,
        status: response.status,
      };
    }
  } catch (error) {
    console.error("❌ WhatsApp service error:", error);
    return {
      success: false,
      error: error.message,
      phoneNumber,
      messageContent: message,
    };
  }
};

/**
 * Send ticket status update WhatsApp message to client
 * @param {string} phoneNumber - Client's phone number
 * @param {Object} ticketInfo - Ticket information
 * @param {string} newStatus - New ticket status
 * @returns {Promise<Object>} API response
 */
export const sendTicketStatusWhatsApp = async (
  phoneNumber,
  ticketInfo,
  newStatus
) => {
  try {
    const { ticketNumber, title, uid } = ticketInfo;

    // Website URL (can be configured via environment variable)
    const websiteUrl = process.env.WEBSITE_URL || "https://medzen-frontend.vercel.app/";

    // Create message using MedZen template
    const message = `Greetings from MedZen writes!

Please provide the requested information on the ticket by using the below link.

🔗 ${websiteUrl}

📋 *Ticket:* ${ticketNumber || uid || "N/A"}
📝 *Title:* ${title || "Untitled"}
📊 *Status:* ${newStatus}

If you are facing any issues please reach out to us on +91 9176365161 on WhatsApp or Voice call`;

    return await sendWhatsAppMessage(phoneNumber, message);
  } catch (error) {
    console.error("❌ Ticket status WhatsApp error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send WhatsApp image
 * @param {string} phoneNumber - Phone number in international format
 * @param {string} imageUrl - Publicly accessible URL of the image
 * @param {string} caption - Optional caption for the image
 * @returns {Promise<Object>} API response
 */
export const sendWhatsAppImage = async (phoneNumber, imageUrl, caption = "") => {
  try {
    console.log("📷 Sending WhatsApp image:", {
      phoneNumber: phoneNumber?.replace(/\d(?=\d{4})/g, "*"),
      imageUrl,
      timestamp: new Date().toISOString(),
    });

    // Validate inputs
    if (!phoneNumber || !imageUrl) {
      throw new Error("Phone number and image URL are required");
    }

    // Format phone number
    const formattedPhone = phoneNumber.replace(/[^\d+]/g, "");
    const internationalPhone = formattedPhone.startsWith("+")
      ? formattedPhone
      : `+${formattedPhone}`;

    // Check if WhatsApp API is configured
    if (!process.env.WHATSAPP_API_TOKEN || !process.env.WHATSAPP_API_BASE_URL) {
      console.log(
        "⚠️ WhatsApp API not configured. Image would be sent to:",
        internationalPhone
      );
      return {
        success: false,
        error: "WhatsApp API not configured",
        phoneNumber: internationalPhone,
      };
    }

    const metaPhoneNumber = internationalPhone.replace("+", "");

    // Prepare payload
    const payload = {
      messaging_product: "whatsapp",
      to: metaPhoneNumber,
      type: "image",
      image: {
        link: imageUrl,
        caption: caption,
      },
    };

    // Send request
    const response = await fetch(process.env.WHATSAPP_API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    if (response.ok) {
      console.log("✅ WhatsApp image sent successfully");
      return {
        success: true,
        data: responseData,
        status: response.status,
      };
    } else {
      console.error("❌ WhatsApp Image API error:", responseData);
      return {
        success: false,
        error: responseData.error?.message,
        details: responseData,
        status: response.status,
      };
    }
  } catch (error) {
    console.error("❌ WhatsApp send image error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send payment stage notification WhatsApp message to client
 * @param {string} phoneNumber - Client's phone number
 * @param {Object} ticketInfo - Ticket information
 * @param {string} stageName - Stage name: 'part_a', 'statistical_results', 'part_b'
 * @returns {Promise<Object>} API response
 */
export const sendPaymentStageWhatsApp = async (
  phoneNumber,
  ticketInfo,
  stageName
) => {
  try {
    // Website/Backend URL for images (defaulting to a placeholder if not set, 
    // BUT for local dev images won't work with Meta API unless using ngrok/tunnel)
    const backendUrl = process.env.BACKEND_URL || "https://your-backend-url.com";

    let message = "";
    let imageUrl = "";

    // Specific templates based on user request
    if (stageName === "part_a") {
      message = `Greetings from MedZen writes ! 

Dear Author!

Part A Introduction, Review Of Literature , Materials & Methods is completed. 
Kindly complete the Payment using the above payment method to proceed further with the next steps. 
If you are facing any issues please reach out to us on +91 9176365161.

Pos.11386702@indus`;

      // Image: payment/partA/paymentA.jpeg
      imageUrl = `${backendUrl}/api/assets/payment/partA/paymentA.jpeg`;

    } else if (stageName === "part_b") {
      message = `Part B Completed - 

Greetings from MedZen writes ! 

Dear Author!

Part B Discussion, Conclusion is completed. 
Kindly complete the Payment using the above payment method to proceed further with the next steps. 
If you are facing any issues please reach out to us on +91 9176365161.

9841499979-2@ybl`;

      // Image: payment/partB/paymentB.jpeg
      imageUrl = `${backendUrl}/api/assets/payment/partB/paymentB.jpeg`;

    } else if (stageName === "statistical_results") {
      message = `*Stats Completed*

Greetings from MedZen writes ! 

Dear Author!

Stats for the thesis is completed. 
Please check out the Application for updates.
If you are facing any issues please reach out to us on +91 9176365161.`;
    } else {
      // Fallback or other future stages
      return {
        success: false,
        error: "Invalid stage name",
      };
    }

    // 1. Send the text message
    const textResponse = await sendWhatsAppMessage(phoneNumber, message);

    // 2. If successful and there's an image to send, send the image
    if (textResponse.success && imageUrl) {
      // Small delay to ensure order? Usually safe to fire immediately but await ensures sequence
      const imageResponse = await sendWhatsAppImage(phoneNumber, imageUrl);

      // Combine results
      return {
        success: textResponse.success && imageResponse.success,
        textResponse,
        imageResponse
      };
    }

    return textResponse;

  } catch (error) {
    console.error("❌ Payment stage WhatsApp error:", error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Send welcome WhatsApp message to new client
 * @param {string} phoneNumber - Client's phone number
 * @param {string} clientName - Client's name
 * @returns {Promise<Object>} API response
 */
export const sendWelcomeWhatsApp = async (phoneNumber, clientName) => {
  const message = `🎉 *Welcome to Medzen Innovations!*

Hello ${clientName || "Valued Client"}!

Thank you for joining Medzen Innovations. We're excited to work with you!

📱 You'll receive WhatsApp updates about your tickets
📧 Check your email for account details
🎫 You can create and track tickets through our platform

Need help? Just reply to this message!

*Medzen Innovations Team*`;

  return await sendWhatsAppMessage(phoneNumber, message);
};

/**
 * Test WhatsApp service configuration
 * @returns {Promise<Object>} Test result
 */
export const testWhatsAppService = async () => {
  try {
    console.log("🧪 Testing WhatsApp service configuration...");

    const config = {
      hasApiToken: !!process.env.WHATSAPP_API_TOKEN,
      hasBaseUrl: !!process.env.WHATSAPP_API_BASE_URL,
      baseUrl: process.env.WHATSAPP_API_BASE_URL,
      tokenLength: process.env.WHATSAPP_API_TOKEN?.length || 0,
    };

    console.log("📋 WhatsApp Configuration:", config);

    if (!config.hasApiToken || !config.hasBaseUrl) {
      return {
        success: false,
        error: "WhatsApp API not fully configured",
        config,
        message:
          "Add WHATSAPP_API_TOKEN and WHATSAPP_API_BASE_URL to .env file",
      };
    }

    // Test with a dummy message (won't actually send)
    const testResult = await sendWhatsAppMessage(
      "+1234567890",
      "Test message - configuration check"
    );

    return {
      success: true,
      config,
      testResult,
      message: "WhatsApp service configuration is valid",
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: "WhatsApp service test failed",
    };
  }
};

export default {
  sendWhatsAppMessage,
  sendWhatsAppImage,
  sendTicketStatusWhatsApp,
  sendPaymentStageWhatsApp,
  sendWelcomeWhatsApp,
  testWhatsAppService,
};
