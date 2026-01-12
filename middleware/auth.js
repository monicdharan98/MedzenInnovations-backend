import jwt from "jsonwebtoken";
import { errorResponse } from "../utils/responses.js";
import { supabase, supabaseAdmin } from "../config/supabase.js";
import { checkTokenExpiration } from "../utils/tokenUtils.js";

/**
 * Verify JWT token and attach user to request
 */
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return errorResponse(res, "Access token required", 401);
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from Supabase using admin client for full access
    const { data: user, error } = await supabaseAdmin
      .from("users")
      .select("*")
      .eq("id", decoded.userId)
      .single();

    if (error || !user) {
      return errorResponse(res, "Invalid or expired token", 401);
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return errorResponse(res, "Token expired", 401, {
        errorCode: "TOKEN_EXPIRED",
        needsRefresh: true,
        message: "Please refresh your token",
      });
    }
    if (error.name === "JsonWebTokenError") {
      return errorResponse(res, "Invalid token format", 401, {
        errorCode: "INVALID_TOKEN",
        needsRefresh: false,
        message: "Please login again",
      });
    }
    return errorResponse(res, "Authentication failed", 401, {
      errorCode: "AUTH_FAILED",
      needsRefresh: false,
      message: "Please login again",
    });
  }
};

/**
 * Check if user has specific role
 */
export const requireRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, "Authentication required", 401);
    }

    // Handle single role or array of roles
    const allowedRoles = Array.isArray(requiredRole)
      ? requiredRole
      : [requiredRole];

    if (!allowedRoles.includes(req.user.role)) {
      return errorResponse(
        res,
        "Insufficient permissions - Admin access required",
        403
      );
    }

    // For admin routes, also check if user is approved
    if (requiredRole === "admin" && req.user.approval_status !== "approved") {
      return errorResponse(res, "Admin account pending approval", 403);
    }

    next();
  };
};
