/* eslint-env node */
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import ticketRoutes from "./routes/tickets.js";
import notificationRoutes from "./routes/notifications.js";
import chatRoutes from "./routes/chat.js";
import whatsappRoutes from "./routes/whatsapp.js";
import { setupChatHandlers } from "./socket/chatHandler.js";

// Get __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "JWT_SECRET"];
const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName]
);

if (missingEnvVars.length > 0) {
  console.error(
    "❌ Missing required environment variables:",
    missingEnvVars.join(", ")
  );
  console.error("Please check your .env file or environment configuration.");
  process.exit(1);
}

// Log configuration (without sensitive data)
console.log("🔧 Configuration loaded:");
console.log("   - Node Environment:", process.env.NODE_ENV || "development");
console.log("   - Port:", process.env.PORT || 5000);
console.log(
  "   - Frontend URL:",
  process.env.FRONTEND_URL || "http://localhost:5173"
);
console.log(
  "   - Supabase URL:",
  process.env.SUPABASE_URL ? "✓ Set" : "✗ Missing"
);
console.log("   - JWT Secret:", process.env.JWT_SECRET ? "✓ Set" : "✗ Missing");
console.log(
  "   - Email Config:",
  process.env.SMTP_USER ? "✓ Set" : "✗ Not configured (OTPs will be logged)"
);
console.log(
  "   - SMS Config:",
  process.env.TWILIO_ACCOUNT_SID ? "✓ Set" : "✗ Not configured"
);
console.log(
  "   - WhatsApp Config:",
  process.env.WHATSAPP_API_TOKEN
    ? "✓ Set"
    : "✗ Not configured (WhatsApp messages will be logged)"
);

// Initialize express app
const app = express();

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO with improved reconnection settings
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
      : [
        "http://localhost:5173",
        "http://localhost:5174",
        "https://medzen-frontend.vercel.app",
        "https://www.medzen-frontend.vercel.app",
        "https://medzen-innovations.vercel.app",
        "https://www.medzen-innovations.vercel.app"
      ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  },
  // Improved settings for Render and unstable connections
  pingTimeout: 60000, // 60 seconds (default is 20s)
  pingInterval: 25000, // 25 seconds (default is 25s)
  upgradeTimeout: 30000, // 30 seconds (default is 10s)
  maxHttpBufferSize: 1e8, // 100 MB (default is 1MB)
  transports: ["websocket", "polling"], // Try websocket first, fallback to polling
  allowUpgrades: true,
  perMessageDeflate: false, // Disable compression for better performance
  httpCompression: false,
});

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.split(",").map((url) => url.trim())
      : [
        "http://localhost:5173",
        "http://localhost:5174",
        "https://medzen-frontend.vercel.app",
        "https://www.medzen-frontend.vercel.app",
        "https://medzen-innovations.vercel.app",
        "https://www.medzen-innovations.vercel.app"
      ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Handle preflight requests explicitly
app.options("*", cors());

app.use(express.json({ limit: "50mb" })); // Increased for larger payloads
app.use(express.urlencoded({ extended: true, limit: "50mb" })); // Increased for form data

// Serve uploaded files
app.use("/api/uploads", express.static(path.join(__dirname, "uploads")));
// Serve payment assets
app.use("/api/assets/payment", express.static(path.join(__dirname, "payment")));

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend server is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    cors: process.env.FRONTEND_URL || "localhost",
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/whatsapp", whatsappRoutes);

// Make io instance available to routes
app.set("io", io);

// Setup Socket.IO chat handlers
setupChatHandlers(io);

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 Socket.IO enabled for real-time chat`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
const gracefulShutdown = (signal) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  httpServer.close(() => {
    console.log("✅ HTTP server closed");
    io.close(() => {
      console.log("✅ Socket.IO closed");
      process.exit(0);
    });
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error("⚠️  Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export default app;
export { io };
