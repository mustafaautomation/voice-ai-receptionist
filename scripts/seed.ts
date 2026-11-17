import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/database.js";
import { seedIfEmpty } from "../src/seed.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const reset = process.argv.includes("--reset");
if (reset) {
  db.exec("DELETE FROM tool_calls; DELETE FROM leads; DELETE FROM calls; DELETE FROM appointments; DELETE FROM idempotency;");
}
const seeded = seedIfEmpty(db, new Date());
const calls = db.prepare("SELECT COUNT(*) AS n FROM calls").get() as { n: number };
const appointments = db.prepare("SELECT COUNT(*) AS n FROM appointments").get() as { n: number };
console.log(seeded ? "Seeded demo data." : "Database already had calls; left it unchanged.");
console.log(`calls=${calls.n} appointments=${appointments.n}`);
