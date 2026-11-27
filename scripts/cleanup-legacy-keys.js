import { db } from "../lib/db.js";

if (process.env.CONFIRM_DELETE_LEGACY_DB_KEYS !== "YES") {
  console.error("This removes legacy encrypted provider-key rows from Turso.");
  console.error("After setting AGNES_API_KEY_1, AGNES_API_KEY_2, ... in your deployment, run with CONFIRM_DELETE_LEGACY_DB_KEYS=YES.");
  process.exit(1);
}

try {
  await db.execute("DELETE FROM api_keys");
  console.log("Legacy database key rows removed. Active API keys are now environment-only.");
} catch (error) {
  if (/no such table/i.test(String(error.message))) console.log("No legacy api_keys table exists; nothing to clean.");
  else throw error;
}
