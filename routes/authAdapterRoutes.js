const express = require("express");
const router = express.Router();
const internalAuth = require("../middleware/internalAuth");
const {
  upsertUser,
  getUserById,
  getUserByEmail,
  updateUser,
  getUserByAccount,
  getAccount,
  linkAccount,
  createVerificationToken,
  useVerificationToken,
  verifyCredentials,
  verifyImpersonationToken,
} = require("../controllers/authAdapterController");

router.use(internalAuth);

router.post("/users", upsertUser);
router.get("/users/by-email/:email", getUserByEmail);
router.get("/users/by-account", getUserByAccount);
router.get("/users/:id", getUserById);
router.patch("/users/:id", updateUser);

router.get("/accounts/:provider/:providerAccountId", getAccount);
router.post("/accounts", linkAccount);

router.post("/verification-tokens", createVerificationToken);
router.post("/verification-tokens/use", useVerificationToken);

router.post("/verify-credentials", verifyCredentials);
router.post("/verify-impersonation-token", verifyImpersonationToken);

module.exports = router;
