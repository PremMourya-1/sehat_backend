const express = require("express");
const router = express.Router();
const { getPasswordStatus, updatePassword } = require("../controllers/accountSecurityController");
const customerAuth = require("../middleware/customerAuth");

router.use(customerAuth);

router.get("/password-status", getPasswordStatus);
router.put("/password", updatePassword);

module.exports = router;
