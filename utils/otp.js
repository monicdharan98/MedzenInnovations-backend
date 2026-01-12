import crypto from "crypto";

/**
 * Generate a 4-digit OTP
 */
export const generateOTP = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Hash OTP for secure storage
 */
export const hashOTP = (otp) => {
  // Ensure OTP is a string and trim any whitespace
  const otpString = String(otp).trim();
  return crypto.createHash("sha256").update(otpString, "utf8").digest("hex");
};

/**
 * Verify OTP against hash
 */
export const verifyOTP = (otp, hash) => {
  // Ensure OTP is a string and trim any whitespace
  const otpString = String(otp).trim();
  const otpHash = hashOTP(otpString);

  console.log("🔐 OTP Verification:", {
    providedOTP: otpString,
    providedOTPLength: otpString.length,
    providedHash: otpHash.substring(0, 20) + "...",
    storedHash: hash ? hash.substring(0, 20) + "..." : "null",
    match: otpHash === hash,
  });

  return otpHash === hash;
};

/**
 * Calculate OTP expiry time (default 10 minutes)
 */
export const getOTPExpiry = (minutes = 10) => {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
};

/**
 * Check if OTP is expired
 */
export const isOTPExpired = (expiryTime) => {
  return new Date(expiryTime) < new Date();
};
