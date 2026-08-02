const express = require("express");
const router = express.Router();
const {
  register,
  verifyRegistrationOtp,
  resendRegistrationOtp,
  logout,
  issueInternalToken,
} = require("../controllers/authController");
const internalAuth = require("../middleware/internalAuth");

router.post("/register", register);
router.post("/register/verify-otp", verifyRegistrationOtp);
router.post("/register/resend-otp", resendRegistrationOtp);

router.post("/logout", logout);
router.post("/internal/issue-token", internalAuth, issueInternalToken);

module.exports = router;
