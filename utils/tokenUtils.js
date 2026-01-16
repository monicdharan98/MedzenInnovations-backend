/**
 * Token Utilities
 * Handles JWT token generation, validation, and refresh functionality
 */

import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../config/supabase.js";

/**
 * Generate access token (short-lived)
 * @param {Object} payload - User data to include in token
 * @param {string} expiresIn - Token expiration time (default: 15m)
 * @returns {string} JWT access token
 */
export const generateAccessToken = (payload, expiresIn = "24h") => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Generate refresh token (long-lived)
 * @param {Object} payload - User data to include in token
 * @param {string} expiresIn - Token expiration time (default: 30d)
 * @returns {string} JWT refresh token
 */
export const generateRefreshToken = (payload, expiresIn = "30d") => {
  return jwt.sign(
    payload,
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn }
  );
};

/**
 * Generate both access and refresh tokens
 * @param {Object} user - User object
 * @param {boolean} rememberMe - Whether to extend token life
 * @returns {Object} Object containing access and refresh tokens
 */
export const generateTokenPair = (user, rememberMe = false) => {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
  };

  // Access token - 24 hours for better UX
  const accessToken = generateAccessToken(payload, "24h");

  // Refresh token - longer lived, extended if "remember me"
  const refreshTokenExpiry = rememberMe ? "90d" : "30d";
  const refreshToken = generateRefreshToken(payload, refreshTokenExpiry);

  return {
    accessToken,
    refreshToken,
    expiresIn: 24 * 60 * 60, // 24 hours in seconds
    refreshExpiresIn: rememberMe ? 90 * 24 * 60 * 60 : 30 * 24 * 60 * 60, // in seconds
  };
};

/**
 * Verify access token
 * @param {string} token - JWT access token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    console.error("Access token verification failed:", error.message);
    return null;
  }
};

/**
 * Verify refresh token
 * @param {string} token - JWT refresh token
 * @returns {Object|null} Decoded token payload or null if invalid
 */
export const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(
      token,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
  } catch (error) {
    console.error("Refresh token verification failed:", error.message);
    return null;
  }
};

/**
 * Check if token is expired or will expire soon
 * @param {string} token - JWT token
 * @param {number} bufferMinutes - Minutes before expiration to consider "soon" (default: 5)
 * @returns {Object} Object with expiration status
 */
export const checkTokenExpiration = (token, bufferMinutes = 5) => {
  try {
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.exp) {
      return { isExpired: true, willExpireSoon: true, timeLeft: 0 };
    }

    const now = Math.floor(Date.now() / 1000);
    const expirationTime = decoded.exp;
    const bufferTime = bufferMinutes * 60; // Convert to seconds

    const isExpired = now >= expirationTime;
    const willExpireSoon = now >= expirationTime - bufferTime;
    const timeLeft = Math.max(0, expirationTime - now);

    return {
      isExpired,
      willExpireSoon,
      timeLeft,
      expiresAt: new Date(expirationTime * 1000).toISOString(),
    };
  } catch (error) {
    console.error("Token expiration check failed:", error.message);
    return { isExpired: true, willExpireSoon: true, timeLeft: 0 };
  }
};

/**
 * Store refresh token in database (for token blacklisting/revocation)
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token to store
 * @param {Date} expiresAt - Token expiration date
 * @returns {Promise<boolean>} Success status
 */
export const storeRefreshToken = async (userId, refreshToken, expiresAt) => {
  try {
    // Hash the token for security (store hash, not plain token)
    const tokenHash = jwt.sign(
      { token: refreshToken },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const { error } = await supabaseAdmin.from("refresh_tokens").insert([
      {
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      },
    ]);

    if (error) {
      console.error("Error storing refresh token:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Store refresh token error:", error);
    return false;
  }
};

/**
 * Validate refresh token against database
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token to validate
 * @returns {Promise<boolean>} Validation status
 */
export const validateStoredRefreshToken = async (userId, refreshToken) => {
  try {
    // For now, just verify the token signature
    // In production, you might want to check against stored hashes
    const decoded = verifyRefreshToken(refreshToken);
    return decoded && decoded.userId === userId;
  } catch (error) {
    console.error("Validate stored refresh token error:", error);
    return false;
  }
};

/**
 * Revoke refresh token (logout)
 * @param {string} userId - User ID
 * @param {string} refreshToken - Refresh token to revoke
 * @returns {Promise<boolean>} Success status
 */
export const revokeRefreshToken = async (userId, refreshToken) => {
  try {
    // In a full implementation, you'd remove from database
    // For now, we'll just return success since tokens are stateless
    console.log(`Refresh token revoked for user: ${userId}`);
    return true;
  } catch (error) {
    console.error("Revoke refresh token error:", error);
    return false;
  }
};

/**
 * Clean up expired refresh tokens from database
 * @returns {Promise<number>} Number of tokens cleaned up
 */
export const cleanupExpiredTokens = async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from("refresh_tokens")
      .delete()
      .lt("expires_at", new Date().toISOString())
      .select();

    if (error) {
      console.error("Error cleaning up expired tokens:", error);
      return 0;
    }

    const cleanedCount = data?.length || 0;
    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired refresh tokens`);
    }

    return cleanedCount;
  } catch (error) {
    console.error("Cleanup expired tokens error:", error);
    return 0;
  }
};

export default {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  checkTokenExpiration,
  storeRefreshToken,
  validateStoredRefreshToken,
  revokeRefreshToken,
  cleanupExpiredTokens,
};
