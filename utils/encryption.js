const crypto = require("crypto");

// Reversible encryption for secrets stored at rest (e.g. third-party
// integration passwords in IntegrationSetting.config) — bcrypt can't be used
// here since those secrets need to come back out in plain text to call the
// third party's own login API. AES-256-GCM: authenticated, so a tampered or
// corrupted value fails decryption loudly instead of silently.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not configured — set a 64-char hex string in .env");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must be a 32-byte key encoded as 64 hex characters");
  }
  return key;
}

// Returns "iv:authTag:ciphertext" (all hex) — a single plain string, safe to
// store in a JSON/text column and reversed by decrypt().
function encrypt(plainText) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

function decrypt(encryptedText) {
  const [ivHex, authTagHex, ciphertextHex] = String(encryptedText).split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error("Invalid encrypted value format");
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]);
  return plaintext.toString("utf8");
}

module.exports = { encrypt, decrypt };
