import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read from process.env or fallback to local .env file
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)$/);
      if (match) {
        connectionString = match[1].trim().replace(/^["']|["']$/g, "");
        break;
      }
    }
  }
}

if (!connectionString) {
  console.error("[Neon KeepAlive] ✗ Error: DATABASE_URL environment variable is not configured.");
  process.exit(1);
}

const sql = neon(connectionString);

async function keepAlive() {
  const startTime = Date.now();
  try {
    const res = await sql`SELECT 1 as keepalive, NOW() as server_time;`;
    const elapsed = Date.now() - startTime;
    console.log(`[Neon KeepAlive] ✓ Database active & warm (${elapsed}ms) - Server Time: ${res[0].server_time}`);
  } catch (err) {
    console.error(`[Neon KeepAlive] ✗ Ping failed:`, err?.message || err);
    process.exit(1);
  }
}

keepAlive();
