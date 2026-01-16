/**
 * Quick WhatsApp Template Test Script
 * Run with: node test-whatsapp.js
 */

import dotenv from "dotenv";

dotenv.config();

const testPhoneNumber = "918667065817"; // India country code without +
const templateName = "medzen_ticket_status"; // Your approved template

// Template parameters (variables {{1}}, {{2}}, {{3}}, {{4}})
const templateParams = [
    "https://medzen-frontend.vercel.app/", // {{1}} - Website URL
    "TKT-TEST-001",                         // {{2}} - Ticket Number
    "Test Ticket Title",                    // {{3}} - Ticket Title
    "In Progress"                           // {{4}} - Status
];

console.log("🚀 Starting WhatsApp Template Test...");
console.log("📱 Sending to:", testPhoneNumber);
console.log("📋 Template:", templateName);
console.log("📝 Parameters:", templateParams);
console.log("---");

// Prepare Meta WhatsApp Business API payload for template message
const payload = {
    messaging_product: "whatsapp",
    to: testPhoneNumber,
    type: "template",
    template: {
        name: templateName,
        language: {
            code: "en_US"  // or "en" depending on your template language
        },
        components: [
            {
                type: "body",
                parameters: templateParams.map(param => ({
                    type: "text",
                    text: param
                }))
            }
        ]
    }
};

console.log("📤 Sending payload:", JSON.stringify(payload, null, 2));

try {
    const response = await fetch(process.env.WHATSAPP_API_BASE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
        },
        body: JSON.stringify(payload),
    });

    const responseData = await response.json();

    console.log("---");
    console.log("📊 Response Status:", response.status);
    console.log("📊 Response Data:", JSON.stringify(responseData, null, 2));

    if (response.ok) {
        console.log("✅ WhatsApp template message sent successfully!");
        console.log("📨 Message ID:", responseData.messages?.[0]?.id);
    } else {
        console.log("❌ Failed to send WhatsApp template message");
        console.log("Error:", responseData.error?.message);
    }
} catch (error) {
    console.error("❌ Error:", error.message);
}
