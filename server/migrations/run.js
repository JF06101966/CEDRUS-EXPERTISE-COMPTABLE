import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const projectRef = (process.env.SUPABASE_URL || '').match(/https?:\/\/([^.]+)/)?.[1];
const password = process.env.SUPABASE_DB_PASSWORD;
if (!projectRef || !password) {
    console.error('Missing SUPABASE_URL or SUPABASE_DB_PASSWORD');
    process.exit(1);
}

// Supabase pooler (IPv4-compatible)
const connectionString = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;

const migrationFile = process.argv[2] || '001_init.sql';
const sql = fs.readFileSync(path.join(__dirname, migrationFile), 'utf8');

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
    await client.connect();
    console.log(`[migrate] connected, executing ${migrationFile}...`);
    await client.query(sql);
    console.log(`[migrate] ✓ ${migrationFile} applied`);
    await client.end();
    process.exit(0);
} catch (err) {
    console.error('[migrate] FAILED:', err.message);
    try { await client.end(); } catch {}
    process.exit(1);
}
