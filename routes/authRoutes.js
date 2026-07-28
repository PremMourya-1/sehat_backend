const express = require("express");
const router = express.Router();
const {
  register,
  verifyOtp,
  resendOtp,
  login,
  logout,
  profile,
  changePassword,
} = require("../controllers/authController");
const customerAuth = require("../middleware/customerAuth");

router.post("/register", register);
router.post("/verify-otp", verifyOtp);
router.post("/resend-otp", resendOtp);
router.post("/login", login);
router.post("/logout", logout);
router.get("/profile", customerAuth, profile);
router.put("/change-password", customerAuth, changePassword);

module.exports = router;
