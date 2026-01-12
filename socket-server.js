/* eslint-env node */
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import { setupChatHandlers } from "./socket/chatHandler.js";

// Load environment variables
dotenv.config();

console.log("🔧 Socket Server Configuration:");
console.log("   - Port:", process.env.PORT || 5000);
console.log(
  "   - Frontend URL:",
  process.env.FRONTEND_URL || "http://localhost:5173"
);
console.log("   - Environment:", process.env.NODE_ENV || "development");

// Create HTTP server (without Express)
const httpServer = createServer((req, res) => {
  // Health check endpoint
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "OK",
        message: "Socket.IO server is running",
        service: "WebSocket Server",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      })
    );
  } else if (req.url === "/ping") {
    // Quick ping endpoint for keeping server awake
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("pong");
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

// Configure allowed origins for CORS
const getAllowedOrigins = () => {
  const defaultOrigins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
    "https://medzen-frontend.vercel.app",
  ];

  // Add custom origins from environment variable
  if (process.env.FRONTEND_URL) {
    const customOrigins = process.env.FRONTEND_URL.split(",").map((url) =>
      url.trim()
    );
    return [...defaultOrigins, ...customOrigins];
  }

  return defaultOrigins;
};

const allowedOrigins = getAllowedOrigins();
console.log("🌐 Allowed CORS origins:", allowedOrigins);

// Initialize Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) {
        console.log("✅ CORS: Allowing request with no origin");
        return callback(null, true);
      }

      // Check if origin is in allowed list
      const isAllowed = allowedOrigins.some((allowedOrigin) => {
        return origin === allowedOrigin || origin.endsWith(".vercel.app");
      });

      if (isAllowed) {
        console.log("✅ CORS: Allowing origin:", origin);
        callback(null, true);
      } else {
        console.log("❌ CORS: Blocking origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-auth-token", "token"],
  },
  transports: ["websocket", "polling"],
  allowEIO3: true,
  pingTimeout: 120000, // 2 minutes - increased for Render.com cold starts
  pingInterval: 25000,
  connectTimeout: 120000, // 2 minutes - increased for initial connection on Render
  upgradeTimeout: 30000, // 30 seconds for transport upgrade
  // Add connection state recovery
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
});

// Connection monitoring
io.engine.on("connection_error", (err) => {
  console.error("❌ Connection error:", {
    message: err.message,
    code: err.code,
    type: err.type,
    req: err.req
      ? {
        url: err.req.url,
        method: err.req.method,
        headers: {
          origin: err.req.headers.origin,
          host: err.req.headers.host,
        },
      }
      : "No request info",
  });
});

// Setup Socket.IO chat handlers
console.log("💬 Setting up Socket.IO handlers...");
setupChatHandlers(io);
console.log("✅ Socket.IO handlers configured");

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Socket.IO server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`💬 WebSocket connections enabled`);
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

export default httpServer;
export { io };
