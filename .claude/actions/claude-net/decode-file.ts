/**
 * Claude Network Action: decode-file
 *
 * Extracts and saves base64-encoded file attachments from Claude inbox messages.
 *
 * Usage:
 *   npx tsx .claude/actions/claude-net/decode-file.ts                    # latest file message
 *   npx tsx .claude/actions/claude-net/decode-file.ts --id 1771198264519-0  # specific message
 *   npx tsx .claude/actions/claude-net/decode-file.ts --output custom.md    # custom output path
 *   npx tsx .claude/actions/claude-net/decode-file.ts --list               # list file messages
 */
import { getRedisClient } from '@livermore/cache';
import { hostname } from 'node:os';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

type RedisClient = ReturnType<typeof getRedisClient>;

async function getIdentity(redis: RedisClient) {
  const host = hostname();
  const sharedRaw = await redis.get('claude:shared');
  if (!sharedRaw) throw new Error('claude:shared key not found in Redis');
  const shared = JSON.parse(sharedRaw);
  const identity = shared?.architecture?.hosts?.[host]?.toLowerCase();
  if (!identity) throw new Error(`Unknown host: ${host}`);
  return identity as string;
}

function parseFields(fields: string[]): Record<string, string> {
  const msg: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    msg[fields[i]] = fields[i + 1];
  }
  return msg;
}

interface FileInfo {
  id: string;
  from: string;
  subject: string;
  filename: string;
  size: string;
  mime: string;
  b64Data: string;
}

function extractFileInfo(id: string, fields: Record<string, string>): FileInfo | null {
  const body = fields.body || '';
  if (!body.includes('FILE_TRANSFER') || !body.includes('BASE64_DATA:')) return null;

  const filenameMatch = body.match(/Filename:\s*(.+)/);
  const sizeMatch = body.match(/Size:\s*(.+)/);
  const mimeMatch = body.match(/MIME:\s*(.+)/);
  const b64Idx = body.indexOf('BASE64_DATA:\n');

  if (b64Idx === -1) return null;

  return {
    id,
    from: fields.from || 'unknown',
    subject: fields.subject || 'untitled',
    filename: filenameMatch?.[1]?.trim() || 'attachment',
    size: sizeMatch?.[1]?.trim() || 'unknown',
    mime: mimeMatch?.[1]?.trim() || 'application/octet-stream',
    b64Data: body.slice(b64Idx + 'BASE64_DATA:\n'.length).trim(),
  };
}

const args = process.argv.slice(2);
function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
}
const listMode = args.includes('--list');

async function main() {
  const redis = getRedisClient();
  await new Promise(r => setTimeout(r, 2000));

  const identity = await getIdentity(redis);
  const streamKey = `claude:${identity}:inbox`;
  const msgs = await redis.xrange(streamKey, '-', '+');

  // Find all file messages
  const fileMessages: FileInfo[] = [];
  for (const [id, fields] of msgs) {
    const parsed = parseFields(fields as string[]);
    const info = extractFileInfo(id, parsed);
    if (info) fileMessages.push(info);
  }

  if (fileMessages.length === 0) {
    console.log('No file attachments found in inbox.');
    await redis.quit();
    return;
  }

  // List mode
  if (listMode) {
    console.log(`Found ${fileMessages.length} file attachment(s):\n`);
    for (const f of fileMessages) {
      console.log(`  ${f.id} | From: ${f.from} | ${f.filename} (${f.size})`);
      console.log(`    Subject: ${f.subject}`);
    }
    await redis.quit();
    return;
  }

  // Find target message
  const targetId = getFlag('id');
  let target: FileInfo;

  if (targetId) {
    const found = fileMessages.find(f => f.id === targetId);
    if (!found) {
      console.error(`Message ${targetId} not found or has no file attachment.`);
      console.log('Available file messages:');
      for (const f of fileMessages) console.log(`  ${f.id} — ${f.filename}`);
      await redis.quit();
      process.exit(1);
      return;
    }
    target = found;
  } else {
    // Default: latest file message
    target = fileMessages[fileMessages.length - 1];
  }

  // Decode and save
  const decoded = Buffer.from(target.b64Data, 'base64').toString('utf-8');
  const outputPath = getFlag('output') || join('tmp', target.filename);

  writeFileSync(outputPath, decoded);

  console.log(`File decoded and saved:`);
  console.log(`  From: ${target.from}`);
  console.log(`  Subject: ${target.subject}`);
  console.log(`  Filename: ${target.filename}`);
  console.log(`  Original size: ${target.size}`);
  console.log(`  Decoded: ${decoded.length} bytes`);
  console.log(`  Saved to: ${outputPath}`);

  await redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
