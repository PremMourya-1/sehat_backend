// One-off, manually-run admin script — submits the 4 WhatsApp message
// templates (see utils/whatsapp.js TEMPLATE_DRAFTS) to Meta for review via
// the Graph API, as an alternative to pasting them into WhatsApp Manager's
// UI by hand. Never invoked automatically (no route, no startup hook) —
// this genuinely mutates a real Meta Business Account's template library,
// so it's deliberately something a human runs on purpose.
//
// Prerequisites: the WhatsApp integration must already be configured
// (Settings > Integrations > WhatsApp) with a real accessToken and
// businessAccountId that has message-template permission.
//
// Usage:
//   node scripts/submitWhatsappTemplates.js           # submit all 4 drafts
//   node scripts/submitWhatsappTemplates.js --status   # check review status
//     of everything already submitted, instead of submitting again
require("dotenv").config();
const { submitAllTemplates, listTemplateStatuses } = require("../utils/whatsapp");

(async () => {
  const checkStatusOnly = process.argv.includes("--status");

  if (checkStatusOnly) {
    const statuses = await listTemplateStatuses();
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }

  const results = await submitAllTemplates();
  console.log(JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.success);
  if (failed.length) {
    console.error(`\n${failed.length} of ${results.length} template(s) failed to submit — see errors above.`);
    console.error("A common cause: the template name already exists on this account (re-submitting a name that");
    console.error("was previously submitted, even if since rejected, requires editing/deleting it in WhatsApp");
    console.error("Manager first — the API won't silently overwrite it).");
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} templates submitted for review. Re-run with --status to check back.`);
  }
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exitCode = 1;
});
