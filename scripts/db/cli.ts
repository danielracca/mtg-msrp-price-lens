/**
 * MTG Price Lens — product database maintenance CLI.
 *
 *   npm run db:refresh                 # fetch registered official sources (polite, cached) and rebuild → review report
 *   npm run db:refresh -- --offline    # rebuild from cached HTML only (no network)
 *   npm run db:refresh -- --write      # write data/products.json if there are no errors
 *   npm run db:validate                # validate data/products.json
 *   npm run db:discover                # look for new "Collecting …" articles not yet in the registry
 *
 * This script is the ONLY component that contacts Wizards of the Coast. The extension never scrapes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDatabase, type SourceRegistry } from '../../src/core/ingest/buildDb';
import { validateDatabase } from '../../src/core/dbValidate';
import type { ProductDatabase } from '../../src/core/types';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const registryPath = join(root, 'scripts/db/sources.json');
const dbPath = join(root, 'data/products.json');
const cacheDir = join(root, 'data/.cache');
const reportPath = join(root, 'data/review-report.md');

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (f: string) => args.includes(f);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);

function loadRegistry(): SourceRegistry {
  return JSON.parse(readFileSync(registryPath, 'utf8'));
}

async function fetchPolitely(url: string, registry: SourceRegistry): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': registry.userAgent, Accept: 'text/html' } });
  if (res.status === 429 || res.status === 503) throw new Error(`Rate limited (${res.status}) — try again later`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function checkRobots(registry: SourceRegistry): Promise<(path: string) => boolean> {
  try {
    const txt = await fetchPolitely('https://magic.wizards.com/robots.txt', registry);
    const disallow: string[] = [];
    let applies = false;
    for (const raw of txt.split('\n')) {
      const line = raw.trim();
      const [k, ...rest] = line.split(':');
      const v = rest.join(':').trim();
      if (/^user-agent$/i.test(k)) applies = v === '*';
      else if (applies && /^disallow$/i.test(k) && v) disallow.push(v);
    }
    return (path) => !disallow.some((d) => path.startsWith(d));
  } catch {
    console.warn('robots.txt unavailable — proceeding with cached sources only for safety');
    return () => false;
  }
}

async function loadSources(registry: SourceRegistry, offline: boolean): Promise<Map<string, string>> {
  mkdirSync(cacheDir, { recursive: true });
  const out = new Map<string, string>();
  const allowed = offline ? () => false : await checkRobots(registry);
  for (const s of registry.sources) {
    const cacheFile = join(cacheDir, `${s.id}.html`);
    if (!offline && allowed(new URL(s.url).pathname)) {
      try {
        const html = await fetchPolitely(s.url, registry);
        writeFileSync(cacheFile, html);
        out.set(s.id, html);
        console.log(`  fetched ${s.id}`);
        await sleep(registry.requestDelayMs);
        continue;
      } catch (e) {
        console.warn(`  ! ${s.id}: ${(e as Error).message} — falling back to cache`);
      }
    }
    if (existsSync(cacheFile)) {
      out.set(s.id, readFileSync(cacheFile, 'utf8'));
      if (offline) console.log(`  cached  ${s.id}`);
    }
  }
  return out;
}

function diff(oldDb: ProductDatabase | null, newDb: ProductDatabase): string[] {
  if (!oldDb) return ['(no previous database)'];
  const lines: string[] = [];
  const old = new Map(oldDb.products.map((p) => [p.id, p]));
  for (const p of newDb.products) {
    const o = old.get(p.id);
    if (!o) lines.push(`+ NEW ${p.id} (${p.msrp.classification}${p.msrp.usd ? ` $${p.msrp.usd}` : ''})`);
    else if (o.msrp.usd !== p.msrp.usd || o.msrp.classification !== p.msrp.classification)
      lines.push(`~ CHANGED ${p.id}: ${o.msrp.classification} ${o.msrp.usd} → ${p.msrp.classification} ${p.msrp.usd}`);
    old.delete(p.id);
  }
  for (const id of old.keys()) lines.push(`- REMOVED ${id} (kept out only if you --write)`);
  return lines;
}

async function refresh() {
  const registry = loadRegistry();
  const offline = flag('--offline');
  console.log(offline ? 'Rebuilding from cache…' : 'Fetching official sources…');
  const fetched = await loadSources(registry, offline);
  const oldDb: ProductDatabase | null = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : null;
  const { db, flags } = buildDatabase(registry, fetched, { today, dbVersion: today.replace(/-/g, '.') });

  // Preserve manually curated fields (UPCs, extra aliases, verification dates) from the existing database.
  if (oldDb) {
    const old = new Map(oldDb.products.map((p) => [p.id, p]));
    for (const p of db.products) {
      const o = old.get(p.id);
      if (!o) continue;
      p.upc = [...new Set([...o.upc, ...p.upc])];
      p.aliases = [...new Set([...p.aliases, ...o.aliases])];
      if (o.msrp.usd === p.msrp.usd && o.msrp.classification === p.msrp.classification) p.lastVerified = today;
    }
  }

  const issues = validateDatabase(db);
  const changes = diff(oldDb, db);
  const errors = flags.filter((f) => f.level === 'error').length + issues.filter((i) => i.level === 'error').length;

  const report = [
    `# MSRP database review report — ${today}`,
    '',
    `Products: ${db.products.length} · Sets: ${db.sets.length} · Errors: ${errors}`,
    '',
    '## Changes vs current database',
    ...changes.map((c) => `- ${c}`),
    '',
    '## Ingestion flags (manual review)',
    ...(flags.length ? flags.map((f) => `- **${f.level}** [${f.sourceId}] ${f.message}`) : ['- none']),
    '',
    '## Validation',
    ...(issues.length ? issues.map((i) => `- **${i.level}** ${i.productId ?? ''} ${i.message}`) : ['- passed']),
    '',
  ].join('\n');
  writeFileSync(reportPath, report);
  console.log(`\n${changes.length} change line(s), ${flags.length} flag(s), ${issues.length} validation issue(s). Report: data/review-report.md`);

  if (flag('--write')) {
    if (errors > 0) {
      console.error('Refusing to write: resolve errors in the review report first.');
      process.exit(1);
    }
    writeFileSync(dbPath, JSON.stringify(db, null, 2) + '\n');
    console.log(`Wrote ${dbPath}`);
  } else {
    console.log('Dry run. Re-run with --write to update data/products.json.');
  }
}

function validate() {
  const db: ProductDatabase = JSON.parse(readFileSync(dbPath, 'utf8'));
  const issues = validateDatabase(db);
  for (const i of issues) console.log(`${i.level.toUpperCase()} ${i.productId ?? ''} ${i.message}`);
  const errors = issues.filter((i) => i.level === 'error').length;
  console.log(`${db.products.length} products, ${errors} error(s), ${issues.length - errors} warning(s).`);
  if (errors) process.exit(1);
}

/** Finds official "collecting-*" / buyer's guide articles not yet registered (via the public sitemap). */
async function discover() {
  const registry = loadRegistry();
  const known = new Set(registry.sources.map((s) => s.url.replace(/\/$/, '')));
  const allowed = await checkRobots(registry);
  if (!allowed('/sitemap.xml')) {
    console.log('Sitemap disallowed by robots.txt; check https://magic.wizards.com/en/news manually.');
    return;
  }
  try {
    const xml = await fetchPolitely('https://magic.wizards.com/sitemap.xml', registry);
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const subs = locs.filter((l) => l.endsWith('.xml')).slice(0, 10);
    const pages = locs.filter((l) => !l.endsWith('.xml'));
    for (const s of subs) {
      await sleep(registry.requestDelayMs);
      try {
        const x = await fetchPolitely(s, registry);
        pages.push(...[...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
      } catch { /* skip */ }
    }
    const candidates = pages.filter((u) => /\/en\/news\/(feature|announcements)\/(collecting-|.*buyers-guide|.*msrp)/.test(u)).filter((u) => !known.has(u.replace(/\/$/, '')));
    console.log(candidates.length ? `New candidate sources (add to scripts/db/sources.json after review):\n${candidates.map((c) => '  ' + c).join('\n')}` : 'No new candidate sources found.');
  } catch (e) {
    console.log(`Discovery failed: ${(e as Error).message}. Check https://magic.wizards.com/en/news manually.`);
  }
}

const commands: Record<string, () => unknown> = { refresh, validate, discover };
if (!commands[cmd]) {
  console.log('Usage: tsx scripts/db/cli.ts <refresh|validate|discover> [--offline] [--write]');
  process.exit(1);
}
await commands[cmd]();
