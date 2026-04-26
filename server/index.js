import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { generateAttestationCA } from './services/pdf-attestation-ca.js';

// Nouveaux modules Supabase / multi-client
import leadsRouter from './routes/leads.js';
import adminRouter from './routes/admin.js';
import clientRouter from './routes/client.js';
import { supabase, verifyUserToken } from './services/supabase.js';
import { getSecret } from './services/secrets.js';
import { plResponseCache, synthCache, synthRefreshing, persistSynthesisCache, loadSynthesisCacheFromDisk } from './services/pl-cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// uploads/ ne sert plus que pour activity-log.json (le reste est sur Supabase Storage)
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const {
    PENNYLANE_COMPANY_NAME = 'EXEMPLE SAS',
    PENNYLANE_COMPANY_ADDRESS = '',
    PENNYLANE_COMPANY_POSTAL = '',
    PENNYLANE_COMPANY_CITY = '',
    PENNYLANE_COMPANY_ACTIVITY = '',
    PORT = 8765
} = process.env;

const PL_BASE = 'https://app.pennylane.com/api/external/v2';

// AsyncLocalStorage pour propager l'auth Pennylane par requête (client connecté)
import { AsyncLocalStorage } from 'node:async_hooks';
const plContext = new AsyncLocalStorage();

// Cache générique pour les réponses GET Pennylane — importé depuis pl-cache.js
// 60s : compromis entre latence affichage et fraîcheur des données. Une trial_balance
// fraîchement modifiée doit pouvoir remonter dans la minute. "Actualiser" force=1
// bypass complètement ce cache.
const PL_CACHE_TTL = 60 * 1000;

// Cache d'auth : token → { user, timestamp } (TTL 5 min)
const authCache = new Map();
const AUTH_CACHE_TTL = 5 * 60 * 1000;

// Cache membership : userId+clientId → { clientProfile, timestamp } (TTL 30 s)
const membershipCache = new Map();
const MEMBERSHIP_CACHE_TTL = 30 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of plResponseCache.entries()) {
        if (now - v.at > PL_CACHE_TTL * 3) plResponseCache.delete(k);
    }
    for (const [k, v] of authCache.entries()) {
        if (now - v.at > AUTH_CACHE_TTL) authCache.delete(k);
    }
    for (const [k, v] of membershipCache.entries()) {
        if (now - v.at > MEMBERSHIP_CACHE_TTL * 4) membershipCache.delete(k);
    }
}, 60 * 1000);

async function currentPlAuth() {
    const ctx = plContext.getStore();
    if (ctx && ctx.apiKey) return ctx;
    const apiKey = await getSecret('pennylane_firm_token');
    const companyId = await getSecret('pennylane_company_id');
    return { apiKey, companyId };
}

async function pl(endpoint, { query = {}, useCompanyHeader = true, traceTag = '' } = {}) {
    const { apiKey, companyId } = await currentPlAuth();
    const url = new URL(PL_BASE + endpoint);
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
    };
    if (useCompanyHeader) headers['X-Company-Id'] = companyId;

    const res = await fetch(url, { headers });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { ok: res.ok, status: res.status, body };
}

// Exporté pour usage dans routes/client.js
export { plContext };

const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

// Fetch all pages (cursor pagination) with retry + mid-fetch delay to avoid
// Pennylane's occasional "warm-up" truncated responses on bursts of requests
async function plAll(endpoint, { query = {}, useCompanyHeader = true, maxPages = 50, debugTag = '' } = {}) {
    let items = [];
    let cursor = null;
    let pages = 0;
    for (let i = 0; i < maxPages; i++) {
        const q = { ...query };
        if (cursor) q.cursor = cursor;

        let r;
        for (let attempt = 0; attempt < 4; attempt++) {
            r = await pl(endpoint, { query: q, useCompanyHeader, traceTag: debugTag });
            if (r.ok) break;
            if (r.status === 429 || r.status >= 500 || r.status === 0) {
                await sleep(600 * (attempt + 1));
                continue;
            }
            break;
        }
        if (!r.ok) {
            if (debugTag) console.warn(`[plAll ${debugTag}] page ${pages + 1} failed status=${r.status}`);
            return { ok: false, status: r.status, body: r.body };
        }

        const list = (r.body && r.body.items) || [];
        items = items.concat(list);
        pages++;
        if (debugTag && pages === 1) {
            const sample = list.slice(0, 5).map(it => it.number).join(',');
            console.log(`[plAll ${debugTag}] page1: ${list.length}items hasMore=${r.body.has_more} first=${sample}`);
        }
        if (!r.body || !r.body.has_more || !r.body.next_cursor) break;
        cursor = r.body.next_cursor;
        await sleep(120);
    }
    if (debugTag) console.log(`[plAll ${debugTag}] TOTAL ${pages}p ${items.length}items`);
    return { ok: true, status: 200, body: { items } };
}

const app = express();

// Body parsers (pour les routes Supabase qui reçoivent du JSON)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes Supabase (multi-client)
app.use(leadsRouter);
app.use(adminRouter);
app.use(clientRouter);

// --------------------------------------------------------------------------
// Proxy /api/client/pennylane/* → /api/pennylane/* en injectant l'auth du client
// via plContext (AsyncLocalStorage). Les routes historiques /api/pennylane/*
// restent valides côté admin/legacy, mais utilisent le contexte par requête.
// --------------------------------------------------------------------------
app.use(async (req, res, next) => {
    if (!req.url.startsWith('/api/client/pennylane/') && !req.url.startsWith('/api/client/pennylane?')) {
        return next();
    }
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) return res.status(401).json({ error: 'missing_token' });

        // Auth cache (TTL 5 min)
        const now = Date.now();
        let user;
        const authHit = authCache.get(token);
        if (authHit && (now - authHit.at) < AUTH_CACHE_TTL) {
            user = authHit.user;
        } else {
            const r = await verifyUserToken(token);
            if (r.error || !r.user) return res.status(401).json({ error: 'invalid_token' });
            user = r.user;
            authCache.set(token, { user, at: now });
        }

        const clientId = req.headers['x-client-id'];
        if (!clientId) return res.status(400).json({ error: 'missing_client_id' });

        // Membership cache (TTL 30s)
        let clientProfile;
        const memberKey = user.id + ':' + clientId;
        const memberHit = membershipCache.get(memberKey);
        if (memberHit && (now - memberHit.at) < MEMBERSHIP_CACHE_TTL) {
            clientProfile = memberHit.clientProfile;
        } else {
            const { data: member } = await supabase
                .from('client_members')
                .select('role, clients(*)')
                .eq('auth_user_id', user.id)
                .eq('client_id', clientId)
                .maybeSingle();
            if (!member || !member.clients) return res.status(403).json({ error: 'not_member_of_this_client' });
            if (member.clients.statut === 'suspended') return res.status(403).json({ error: 'account_suspended' });
            clientProfile = member.clients;
            membershipCache.set(memberKey, { clientProfile, at: now });
        }
        const companyId = clientProfile.pennylane_company_id;
        if (!companyId) {
            return res.status(409).json({
                error: 'pennylane_not_configured',
                message: "Votre dossier Pennylane n'est pas encore connecté. Un conseiller CEDRUS va s'en charger sous peu."
            });
        }
        const apiKey = clientProfile.pennylane_api_key || (await getSecret('pennylane_firm_token'));

        // Rewrite : /api/client/pennylane/X → /api/pennylane/X
        req.url = req.url.replace(/^\/api\/client\/pennylane\//, '/api/pennylane/');

        plContext.run({ apiKey, companyId, clientProfile }, () => {
            // Cache générique GET (60s TTL) pour les endpoints listables
            if (req.method !== 'GET') return next();
            // ?force=1 : on bypass le cache et on invalide les entrées stale pour ce dossier
            const force = req.query?.force === '1';
            const cacheKey = `${companyId}:${req.url}`;
            const now = Date.now();
            if (!force) {
                const hit = plResponseCache.get(cacheKey);
                if (hit && (now - hit.at) < PL_CACHE_TTL) {
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('X-Cache', 'HIT');
                    return res.send(hit.body);
                }
            } else {
                // Purge tout ce qui concerne ce dossier pour garantir des données fraîches
                for (const k of plResponseCache.keys()) {
                    if (k.startsWith(companyId + ':')) plResponseCache.delete(k);
                }
            }
            // Intercepte la réponse pour la cacher
            const origSend = res.send.bind(res);
            res.send = function(body) {
                if (res.statusCode >= 200 && res.statusCode < 300 && body) {
                    plResponseCache.set(cacheKey, { at: Date.now(), body: Buffer.isBuffer(body) ? body : String(body) });
                }
                res.setHeader('X-Cache', 'MISS');
                return origSend(body);
            };
            const origJson = res.json.bind(res);
            res.json = function(obj) {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try { plResponseCache.set(cacheKey, { at: Date.now(), body: JSON.stringify(obj) }); } catch {}
                }
                res.setHeader('X-Cache', 'MISS');
                return origJson(obj);
            };
            next();
        });
    } catch (err) {
        console.error('[pennylane-proxy]', err);
        res.status(500).json({ error: 'proxy_failed', details: String(err.message || err) });
    }
});

app.get('/api/pennylane/me', async (_req, res) => {
    const r = await pl('/me');
    res.status(r.status).json(r.body);
});

// Diagnostic temporaire — à supprimer après debug
app.get('/api/_diag', (_req, res) => {
    const url = process.env.SUPABASE_URL || '';
    const anon = process.env.SUPABASE_ANON_KEY || '';
    const srk = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    res.json({
        supabase_url: url,
        anon_last8: anon.slice(-8),
        anon_len: anon.length,
        srk_last8: srk.slice(-8),
        srk_len: srk.length,
        node_env: process.env.NODE_ENV || '(non défini)',
        site_url: process.env.SITE_URL || '(non défini)'
    });
});

// Greffe du RCS déduit du code postal (utilisé par l'attestation de CA)
const RCS_PAR_DEPT = {
    '75': 'Paris',           '77': 'Meaux',        '78': 'Versailles',
    '91': 'Evry',            '92': 'Nanterre',     '93': 'Bobigny',
    '94': 'Créteil',         '95': 'Pontoise',
    '69': 'Lyon',            '13': 'Marseille',    '33': 'Bordeaux',
    '31': 'Toulouse',        '59': 'Lille',        '44': 'Nantes',
    '67': 'Strasbourg',      '06': 'Nice',         '34': 'Montpellier',
    '35': 'Rennes',          '38': 'Grenoble',     '83': 'Toulon',
    '76': 'Rouen',           '30': 'Nîmes',        '51': 'Reims'
};
function rcsFromCp(cp, ville) {
    if (!cp) return ville || '';
    const dept = String(cp).slice(0, 2);
    return RCS_PAR_DEPT[dept] || ville || '';
}

app.get('/api/pennylane/fiscal-years', async (_req, res) => {
    const r = await pl('/fiscal_years');
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/bank-accounts', async (_req, res) => {
    const r = await pl('/bank_accounts', { query: { per_page: 50 } });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/placements', async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const end = req.query.end || effectivePeriodEnd(year);
    try {
        const r = await plAll('/trial_balance', {
            query: { period_start: `${year}-01-01`, period_end: end }
        });
        if (!r.ok) return res.status(r.status).json(r.body);
        const items = (r.body.items || [])
            .filter(it => String(it.number || '').startsWith('50'))
            .map(it => ({
                number: String(it.number || ''),
                label: it.label || '',
                debits: parseFloat(it.debits || 0),
                credits: parseFloat(it.credits || 0),
                balance: parseFloat(it.debits || 0) - parseFloat(it.credits || 0)
            }))
            .filter(a => a.balance !== 0)
            .sort((a, b) => b.balance - a.balance);
        const total = items.reduce((s, a) => s + a.balance, 0);
        res.json({ year, periodEnd: end, items, total });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

app.get('/api/pennylane/trial-balance', async (req, res) => {
    const { start, end } = req.query;
    if (!start || !end) {
        return res.status(400).json({ error: 'Missing "start" and "end" query parameters (YYYY-MM-DD)' });
    }
    const r = await plAll('/trial_balance', {
        query: { period_start: start, period_end: end }
    });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/customers', async (_req, res) => {
    const r = await pl('/customers', { query: { per_page: 50 } });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/suppliers', async (_req, res) => {
    const r = await pl('/suppliers', { query: { per_page: 50 } });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/ledger-accounts', async (_req, res) => {
    const r = await pl('/ledger_accounts', { query: { limit: 100 } });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/transactions', async (req, res) => {
    const limit = req.query.limit || 25;
    const r = await pl('/transactions', { query: { limit } });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/customer-invoices', async (req, res) => {
    const limit = req.query.limit || 25;
    const r = await pl('/customer_invoices', { query: { limit } });
    res.status(r.status).json(r.body);
});

app.get('/api/pennylane/supplier-invoices', async (req, res) => {
    const limit = req.query.limit || 25;
    const r = await pl('/supplier_invoices', { query: { limit } });
    res.status(r.status).json(r.body);
});

// ===== SYNTHESIS (Pennylane-style KPIs + monthly charts) =====
// synthCache, synthRefreshing, persistSynthesisCache, loadSynthesisCacheFromDisk
// sont importés depuis services/pl-cache.js pour pouvoir être purgés depuis
// les routes admin lors d'un changement de clé Pennylane.
const SYNTH_TTL = 2 * 60 * 1000;
loadSynthesisCacheFromDisk();

function lastDayOfMonth(year, month) {
    // month is 1-12. Use UTC to avoid local-timezone day shifts.
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
function todayIso() {
    return new Date().toISOString().slice(0, 10);
}
function effectivePeriodEnd(year) {
    // Cap at today for the current year, else full-year
    const today = todayIso();
    const currentYear = Number(today.slice(0, 4));
    if (Number(year) === currentYear) return today;
    return `${year}-12-31`;
}

function sumCA(items) {
    return items.reduce((s, it) => {
        const n = String(it.number || '');
        if (n.startsWith('70')) return s + (parseFloat(it.credits || 0) - parseFloat(it.debits || 0));
        return s;
    }, 0);
}
function sumBanks(items) {
    // Banques (512x) + Chèques postaux (514x) + Caisse (53x)
    return items.reduce((s, it) => {
        const n = String(it.number || '');
        if (n.startsWith('512') || n.startsWith('514') || n.startsWith('53')) {
            return s + (parseFloat(it.debits || 0) - parseFloat(it.credits || 0));
        }
        return s;
    }, 0);
}
function sumPlacements(items) {
    // Valeurs mobilières de placement (50x)
    return items.reduce((s, it) => {
        const n = String(it.number || '');
        if (n.startsWith('50')) {
            return s + (parseFloat(it.debits || 0) - parseFloat(it.credits || 0));
        }
        return s;
    }, 0);
}
function sumDispo(items) {
    // Disponibilités globales = Banques + Placements
    return sumBanks(items) + sumPlacements(items);
}
function sumOpCharges(items) {
    return items.reduce((s, it) => {
        const n = String(it.number || '');
        if (/^6[01234]/.test(n)) return s + (parseFloat(it.debits || 0) - parseFloat(it.credits || 0));
        return s;
    }, 0);
}
function sumOpProducts(items) {
    // Produits d'exploitation: 70, 71, 72, 74
    return items.reduce((s, it) => {
        const n = String(it.number || '');
        if (/^7[0124]/.test(n)) return s + (parseFloat(it.credits || 0) - parseFloat(it.debits || 0));
        return s;
    }, 0);
}
function sumAllCharges(items) {
    // Toutes charges de la classe 6
    return items.reduce((s, it) => {
        const n = String(it.number || '');
        if (/^6/.test(n)) return s + (parseFloat(it.debits || 0) - parseFloat(it.credits || 0));
        return s;
    }, 0);
}

// Returns the sum of credits on class 6 accounts dated YYYY-MM-01
// (typically reversal entries of previous-month accruals).
// We exclude those from the YTD charges because they distort the view.
async function getFirstOfMonthChargeCredits(year, month, accountFilter) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-01`;
    const r = await plAll('/ledger_entry_lines', {
        query: {
            limit: 100,
            filter: JSON.stringify([{ field: 'date', operator: 'eq', value: dateStr }])
        },
        maxPages: 10
    });
    if (!r.ok) return { total: 0, byAccount: {} };
    const byAccount = {};
    let total = 0;
    for (const l of r.body?.items || []) {
        const num = String(l.ledger_account?.number || '');
        if (!/^6/.test(num)) continue;
        if (accountFilter && !accountFilter(num)) continue;
        const credit = parseFloat(l.credit || 0);
        if (!credit) continue;
        byAccount[num] = (byAccount[num] || 0) + credit;
        total += credit;
    }
    return { total, byAccount };
}

// Sequentially fetch monthly trial balances to avoid rate limits.
// If refMonth/refDay are provided, the period is capped (YTD); otherwise full year.
async function computeYearData(year, refMonth, refDay) {
    const yStart = `${year}-01-01`;
    const monthlyCa = [];
    const monthlyDispo = [];
    const monthlyBanks = [];
    const monthlyPlacements = [];
    const monthlyCharges = [];
    const hasCap = !!refMonth;

    for (let m = 1; m <= 12; m++) {
        if (hasCap && m > refMonth) {
            monthlyCa.push(0);
            monthlyCharges.push(0);
            monthlyDispo.push(0);
            monthlyBanks.push(0);
            monthlyPlacements.push(0);
            continue;
        }
        const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
        let mEnd;
        if (hasCap && m === refMonth) {
            const lastDay = Number(lastDayOfMonth(year, m).slice(8, 10));
            const capDay = Math.min(refDay, lastDay);
            mEnd = `${year}-${String(m).padStart(2, '0')}-${String(capDay).padStart(2, '0')}`;
        } else {
            mEnd = lastDayOfMonth(year, m);
        }

        await sleep(80);
        const rMonth = await plAll('/trial_balance', { query: { period_start: mStart, period_end: mEnd }, debugTag: `${year}-${m}-month` });
        await sleep(80);
        const rCumu = await plAll('/trial_balance', { query: { period_start: yStart, period_end: mEnd }, debugTag: `${year}-${m}-cumu` });
        const mi = rMonth.body.items || [];
        const ci = rCumu.body.items || [];
        monthlyCa.push(sumCA(mi));
        monthlyCharges.push(sumAllCharges(mi));
        const banks = sumBanks(ci);
        const placements = sumPlacements(ci);
        monthlyBanks.push(banks);
        monthlyPlacements.push(placements);
        monthlyDispo.push(banks + placements);
    }

    const totalCa = monthlyCa.reduce((a, b) => a + b, 0);
    let totalCharges = monthlyCharges.reduce((a, b) => a + b, 0);
    const endIdx = hasCap ? refMonth - 1 : 11; // 11 = December for full-year
    const endBanks = monthlyBanks[endIdx] || 0;
    const endPlacements = monthlyPlacements[endIdx] || 0;
    const endDispo = endBanks + endPlacements;

    // Exclude class 6 credits dated YYYY-refMonth-01 from charges — only when capping YTD
    if (hasCap) {
        const adj = await getFirstOfMonthChargeCredits(year, refMonth);
        totalCharges += adj.total;
        if (refMonth >= 1 && refMonth <= 12) {
            monthlyCharges[refMonth - 1] += adj.total;
        }
    }

    return {
        kpis: {
            ca: totalCa,
            dispo: endDispo,
            banques: endBanks,
            placements: endPlacements,
            charges: totalCharges
        },
        monthlyCa,
        monthlyDispo,
        monthlyBanks,
        monthlyPlacements,
        monthlyCharges
    };
}

async function buildSynthesis(year, compare) {
    const today = new Date();
    const refMonth = today.getUTCMonth() + 1;
    const refDay = today.getUTCDate();
    const currentYear = today.getUTCFullYear();
    const pad = (n) => String(n).padStart(2, '0');

    // If focused on the current year, compare same-period YTD (N vs N-1).
    // If focused on a past year (balance sheet finalized), compare full years (N-1 vs N-2).
    const isCurrent = Number(year) === currentYear;
    const capArgs = isCurrent ? [refMonth, refDay] : [null, null];

    // Séquentiel pour éviter de hit le rate-limit Pennylane (429)
    const cur = await computeYearData(year, capArgs[0], capArgs[1]);
    const prev = await computeYearData(compare, capArgs[0], capArgs[1]);

    const refCurrent = isCurrent
        ? `${year}-${pad(refMonth)}-${pad(Math.min(refDay, Number(lastDayOfMonth(year, refMonth).slice(8,10))))}`
        : `${year}-12-31`;
    const refPrevious = isCurrent
        ? `${compare}-${pad(refMonth)}-${pad(Math.min(refDay, Number(lastDayOfMonth(compare, refMonth).slice(8,10))))}`
        : `${compare}-12-31`;

    return {
        year, compare,
        isCurrent,
        refMonth, refDay,
        refDateCurrent: refCurrent,
        refDatePrevious: refPrevious,
        previousPeriodLabel: isCurrent
            ? String(compare) + ' (même période)'
            : String(compare) + ' (année complète)',
        current: cur.kpis,
        previous: prev.kpis,
        months: ['Jan.','Fév.','Mars','Avr.','Mai','Juin','Juil.','Août','Sep.','Oct.','Nov.','Déc.'],
        charts: {
            ca: { current: cur.monthlyCa, previous: prev.monthlyCa },
            dispo: { current: cur.monthlyDispo, previous: prev.monthlyDispo }
        }
    };
}

function scheduleSynthesisRefresh(cacheKey, year, compare, ctxSnapshot) {
    if (synthRefreshing.has(cacheKey)) return;
    synthRefreshing.add(cacheKey);
    const run = () => buildSynthesis(year, compare)
        .then(data => {
            synthCache.set(cacheKey, { at: Date.now(), data });
            persistSynthesisCache();
            console.log(`[synth] refreshed ${cacheKey}`);
        })
        .catch(e => console.warn(`[synth] refresh ${cacheKey} failed:`, e))
        .finally(() => synthRefreshing.delete(cacheKey));
    if (ctxSnapshot) {
        plContext.run(ctxSnapshot, run);
    } else {
        run();
    }
}

app.get('/api/pennylane/ledger-lines', async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const accountNumber = req.query.account || '';
    const prefix = req.query.prefix || '';
    const endDate = req.query.end || effectivePeriodEnd(year);
    const excludeChargesReversal = req.query.excludeChargesReversal === '1';
    const refMonth = Number(endDate.slice(5, 7));
    const reversalDate = `${year}-${String(refMonth).padStart(2, '0')}-01`;
    const filterStr = JSON.stringify([
        { field: 'date', operator: 'gteq', value: `${year}-01-01` },
        { field: 'date', operator: 'lteq', value: endDate }
    ]);
    try {
        const [linesR, entriesR] = await Promise.all([
            plAll('/ledger_entry_lines', { query: { limit: 100, filter: filterStr }, maxPages: 100 }),
            plAll('/ledger_entries', { query: { limit: 100, filter: filterStr }, maxPages: 100 })
        ]);
        if (!linesR.ok) return res.status(linesR.status).json(linesR.body);
        let items = linesR.body.items || [];
        if (accountNumber) {
            items = items.filter(l => String(l.ledger_account?.number || '') === accountNumber);
        } else if (prefix) {
            items = items.filter(l => String(l.ledger_account?.number || '').startsWith(prefix));
        }
        if (excludeChargesReversal) {
            items = items.filter(l => {
                const num = String(l.ledger_account?.number || '');
                const credit = parseFloat(l.credit || 0);
                return !(/^6/.test(num) && l.date === reversalDate && credit > 0);
            });
        }
        const entriesById = {};
        for (const e of (entriesR.body?.items || [])) entriesById[e.id] = e;

        items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const normalized = items.map(l => {
            const entry = entriesById[l.ledger_entry?.id] || {};
            return {
                id: l.id,
                date: l.date,
                label: l.label || (entry.label || '').split('\n')[0].trim(),
                debit: parseFloat(l.debit || 0),
                credit: parseFloat(l.credit || 0),
                accountNumber: l.ledger_account?.number || '',
                pieceNumber: entry.piece_number || null,
                invoiceNumber: entry.invoice_number || null,
                ledgerEntryId: l.ledger_entry?.id || null
            };
        });
        res.json({ year, accountNumber, prefix, items: normalized, count: normalized.length });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

app.get('/api/pennylane/ca-breakdown', async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const end = req.query.end || effectivePeriodEnd(year);
    try {
        const r = await plAll('/trial_balance', {
            query: { period_start: `${year}-01-01`, period_end: end }
        });
        if (!r.ok) return res.status(r.status).json(r.body);
        const items = r.body.items || [];
        const ca = items
            .filter(it => /^70/.test(String(it.number || '')))
            .map(it => ({
                number: String(it.number || ''),
                label: it.label || '',
                credits: parseFloat(it.credits || 0),
                debits: parseFloat(it.debits || 0),
                net: parseFloat(it.credits || 0) - parseFloat(it.debits || 0)
            }))
            .sort((a, b) => b.net - a.net);
        const total = ca.reduce((s, a) => s + a.net, 0);
        res.json({ year, periodEnd: end, items: ca, total });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

const CHARGE_CLASS_LABELS = {
    '60': 'Achats',
    '61': 'Services extérieurs',
    '62': 'Autres services extérieurs',
    '63': 'Impôts, taxes et versements assimilés',
    '64': 'Charges de personnel',
    '65': 'Autres charges de gestion courante',
    '66': 'Charges financières',
    '67': 'Charges exceptionnelles',
    '68': 'Dotations aux amortissements et provisions',
    '69': 'Participation, impôts sur les bénéfices'
};

app.get('/api/pennylane/income-statement', async (req, res) => {
    const end = req.query.end;
    if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        return res.status(400).json({ error: 'end date required (YYYY-MM-DD)' });
    }
    const year = end.slice(0, 4);
    const start = `${year}-01-01`;
    try {
        const r = await plAll('/trial_balance', { query: { period_start: start, period_end: end } });
        if (!r.ok) return res.status(r.status).json(r.body);
        const items = r.body.items || [];

        // Classify each account into a SIG bucket
        function bucket(n) {
            n = String(n);
            if (n.startsWith('707')) return 'ventesMarchandises';
            if (n.startsWith('6037') || n.startsWith('607')) return 'coutMarchandises';
            if (/^70[1-6]/.test(n) || n.startsWith('708')) return 'productionVendue';
            if (n.startsWith('713') || n.startsWith('71')) return 'productionStockee';
            if (n.startsWith('72')) return 'productionImmobilisee';
            if (/^60/.test(n)) return 'achatsMp';
            if (/^61/.test(n) || /^62/.test(n)) return 'autresAchatsCharges';
            if (/^63/.test(n)) return 'impotsTaxes';
            if (/^64/.test(n)) return 'chargesPersonnel';
            if (n.startsWith('74')) return 'subventionsExpl';
            if (/^75/.test(n) || n.startsWith('781') || n.startsWith('791')) return 'autresProduits';
            if (/^65/.test(n) || n.startsWith('681') || n.startsWith('687')) return 'autresCharges';
            if (/^76/.test(n) || n.startsWith('786') || n.startsWith('796')) return 'produitsFin';
            if (/^66/.test(n) || n.startsWith('686') || n.startsWith('696')) return 'chargesFin';
            if (/^77/.test(n) || n.startsWith('787') || n.startsWith('797')) return 'produitsExc';
            if (/^67/.test(n)) return 'chargesExc';
            if (/^691/.test(n)) return 'participation';
            if (/^695/.test(n) || /^698/.test(n) || /^699/.test(n)) return 'impot';
            return null;
        }

        const PRODUCT_BUCKETS = new Set([
            'ventesMarchandises', 'productionVendue', 'productionStockee', 'productionImmobilisee',
            'subventionsExpl', 'autresProduits', 'produitsFin', 'produitsExc'
        ]);

        const groups = {};
        for (const it of items) {
            const b = bucket(it.number);
            if (!b) continue;
            const debits = parseFloat(it.debits || 0);
            const credits = parseFloat(it.credits || 0);
            const isProduct = PRODUCT_BUCKETS.has(b);
            const net = isProduct ? (credits - debits) : (debits - credits);
            if (!groups[b]) groups[b] = [];
            groups[b].push({ number: String(it.number), label: it.label || '', debits, credits, net });
        }
        for (const k of Object.keys(groups)) groups[k].sort((a, b) => b.net - a.net);

        const totalOf = (k) => (groups[k] || []).reduce((s, a) => s + a.net, 0);

        const ventesMarchandises = totalOf('ventesMarchandises');
        const coutMarchandises = totalOf('coutMarchandises');
        const margeCommerciale = ventesMarchandises - coutMarchandises;

        const productionVendue = totalOf('productionVendue');
        const productionStockee = totalOf('productionStockee');
        const productionImmobilisee = totalOf('productionImmobilisee');
        const productionExercice = productionVendue + productionStockee + productionImmobilisee;

        const achatsMp = totalOf('achatsMp');
        const autresAchatsCharges = totalOf('autresAchatsCharges');
        const consommations = achatsMp + autresAchatsCharges;

        const valeurAjoutee = margeCommerciale + productionExercice - consommations;

        const subventionsExpl = totalOf('subventionsExpl');
        const impotsTaxes = totalOf('impotsTaxes');
        const chargesPersonnel = totalOf('chargesPersonnel');
        const ebe = valeurAjoutee + subventionsExpl - impotsTaxes - chargesPersonnel;

        const autresProduits = totalOf('autresProduits');
        const autresCharges = totalOf('autresCharges');
        const resultatExploitation = ebe + autresProduits - autresCharges;

        const produitsFin = totalOf('produitsFin');
        const chargesFin = totalOf('chargesFin');
        const resultatFinancier = produitsFin - chargesFin;
        const resultatCourant = resultatExploitation + resultatFinancier;

        const produitsExc = totalOf('produitsExc');
        const chargesExc = totalOf('chargesExc');
        const resultatExceptionnel = produitsExc - chargesExc;

        const participation = totalOf('participation');
        const impot = totalOf('impot');
        const resultatNet = resultatCourant + resultatExceptionnel - participation - impot;

        const totalProduits = productionVendue + ventesMarchandises + productionStockee + productionImmobilisee
            + subventionsExpl + autresProduits + produitsFin + produitsExc;

        res.json({
            periodStart: start, periodEnd: end,
            groups,
            totals: {
                ventesMarchandises, coutMarchandises, margeCommerciale,
                productionVendue, productionStockee, productionImmobilisee, productionExercice,
                achatsMp, autresAchatsCharges, consommations,
                valeurAjoutee,
                subventionsExpl, impotsTaxes, chargesPersonnel, ebe,
                autresProduits, autresCharges, resultatExploitation,
                produitsFin, chargesFin, resultatFinancier,
                resultatCourant,
                produitsExc, chargesExc, resultatExceptionnel,
                participation, impot, resultatNet,
                totalProduits
            }
        });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

app.get('/api/pennylane/charges-breakdown', async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const end = req.query.end || effectivePeriodEnd(year);
    const refMonth = Number(end.slice(5, 7));
    try {
        const [r, adj] = await Promise.all([
            plAll('/trial_balance', { query: { period_start: `${year}-01-01`, period_end: end } }),
            getFirstOfMonthChargeCredits(year, refMonth)
        ]);
        if (!r.ok) return res.status(r.status).json(r.body);
        const items = r.body.items || [];
        const adjByAccount = adj.byAccount || {};

        const charges = items
            .filter(it => /^6/.test(String(it.number || '')))
            .map(it => {
                const number = String(it.number || '');
                const adjustment = adjByAccount[number] || 0;
                const credits = parseFloat(it.credits || 0) - adjustment;
                const debits = parseFloat(it.debits || 0);
                return {
                    number,
                    classCode: number.slice(0, 2),
                    label: it.label || '',
                    credits,
                    debits,
                    net: debits - credits
                };
            });

        const byClass = {};
        for (const c of charges) {
            const cls = c.classCode;
            if (!byClass[cls]) byClass[cls] = {
                classCode: cls,
                classLabel: CHARGE_CLASS_LABELS[cls] || ('Classe ' + cls),
                accounts: [],
                total: 0
            };
            byClass[cls].accounts.push(c);
            byClass[cls].total += c.net;
        }
        const classes = Object.values(byClass)
            .map(g => {
                g.accounts.sort((a, b) => b.net - a.net);
                return g;
            })
            .sort((a, b) => b.total - a.total);
        const total = charges.reduce((s, c) => s + c.net, 0);

        res.json({ year, periodEnd: end, classes, total });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

app.get('/api/pennylane/synthesis', async (req, res) => {
    const year = Number(req.query.year) || new Date().getFullYear();
    const compare = Number(req.query.compare) || year - 1;
    const force = req.query.force === '1';
    // Include company_id in cache key so each dossier has its own cache
    const ctx = plContext.getStore();
    const companyKey = ctx?.companyId || (await getSecret('pennylane_company_id')) || 'default';
    const cacheKey = `${companyKey}-${year}-${compare}-${todayIso()}`;
    const hit = synthCache.get(cacheKey);
    const now = Date.now();

    // Capture current context to pass to background refreshes
    const ctxSnapshot = ctx ? { apiKey: ctx.apiKey, companyId: ctx.companyId, clientProfile: ctx.clientProfile } : null;

    if (hit && !force) {
        const stale = (now - hit.at) >= SYNTH_TTL;
        res.json({ ...hit.data, cachedAt: hit.at, stale, refreshing: stale && !synthRefreshing.has(cacheKey) });
        if (stale) scheduleSynthesisRefresh(cacheKey, year, compare, ctxSnapshot);
        return;
    }

    // Pas de cache pour aujourd'hui (ou force=1) : on calcule en synchrone.
    // Plus de fallback "valeur d'hier" pour éviter d'afficher de fausses données.
    try {
        const data = await buildSynthesis(year, compare);
        synthCache.set(cacheKey, { at: Date.now(), data });
        persistSynthesisCache();
        res.json({ ...data, cachedAt: Date.now(), stale: false, refreshing: false });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

// ===== CLIENT ACTIVITY LOG (téléchargements, générations de situation) =====
const ACTIVITY_PATH = path.join(UPLOAD_DIR, 'activity-log.json');
if (!fs.existsSync(ACTIVITY_PATH)) fs.writeFileSync(ACTIVITY_PATH, '[]');
function readActivity() {
    try { return JSON.parse(fs.readFileSync(ACTIVITY_PATH, 'utf8')); } catch { return []; }
}
function writeActivity(data) {
    try { fs.writeFileSync(ACTIVITY_PATH, JSON.stringify(data, null, 2)); } catch {}
}

app.get('/api/client-activity', (_req, res) => {
    const items = readActivity().slice(-200).reverse();
    res.json({ items });
});

app.post('/api/client-activity', express.json(), (req, res) => {
    const { type, label, section, period, action } = req.body || {};
    if (!type || !label) return res.status(400).json({ error: 'type and label required' });
    const entry = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        type: String(type).slice(0, 50),
        label: String(label).slice(0, 200),
        section: section ? String(section).slice(0, 80) : null,
        period: period ? String(period).slice(0, 80) : null,
        action: action ? String(action).slice(0, 30) : 'download'
    };
    const log = readActivity();
    log.push(entry);
    if (log.length > 1000) log.splice(0, log.length - 1000);
    writeActivity(log);
    res.json({ ok: true, entry });
});

app.get('/api/pennylane/company-info', async (_req, res) => {
    // Si on a un clientProfile dans le contexte (requête multi-client via proxy),
    // on utilise les données enrichies du dossier Supabase
    const ctx = plContext.getStore();
    if (ctx?.clientProfile) {
        const c = ctx.clientProfile;
        return res.json({
            id: Number(c.pennylane_company_id) || null,
            name: c.raison_sociale || '',
            siren: c.siren || '',
            siret: c.siret || '',
            forme: c.forme_juridique || '',
            address: c.adresse || '',
            postalCode: c.code_postal || '',
            city: c.ville || '',
            activity: c.activite || c.code_naf || '',
            naf: c.code_naf || '',
            rcsVille: rcsFromCp(c.code_postal, c.ville)
        });
    }
    // Fallback legacy : société par défaut depuis env
    let siren = '';
    try {
        const r = await pl('/me');
        if (r.ok) siren = r.body?.company?.reg_no || '';
    } catch {}
    const legacyCompanyId = await getSecret('pennylane_company_id');
    res.json({
        id: legacyCompanyId ? Number(legacyCompanyId) : null,
        name: PENNYLANE_COMPANY_NAME,
        siren,
        address: PENNYLANE_COMPANY_ADDRESS,
        postalCode: PENNYLANE_COMPANY_POSTAL,
        city: PENNYLANE_COMPANY_CITY,
        activity: PENNYLANE_COMPANY_ACTIVITY,
        rcsVille: rcsFromCp(PENNYLANE_COMPANY_POSTAL, PENNYLANE_COMPANY_CITY)
    });
});

// ---- Attestation de chiffre d'affaires ----
// POST /api/attestation-ca → renvoie un PDF directement téléchargeable.
// Corps attendu (JSON) : { client: { raison_sociale, adresse, code_postal, ville, rcs_ville, siren },
//                          periode: { annee } | { date_debut, date_fin },
//                          montant_ca, ville_emission, date_emission }
app.post('/api/attestation-ca', express.json({ limit: '1mb' }), async (req, res) => {
    try {
        const body = req.body || {};
        if (!body.client || !body.client.raison_sociale) {
            return res.status(400).json({ error: 'client.raison_sociale requis' });
        }
        if (body.montant_ca == null || isNaN(Number(body.montant_ca))) {
            return res.status(400).json({ error: 'montant_ca (numérique) requis' });
        }
        if (!body.periode || (!body.periode.annee && !(body.periode.date_debut && body.periode.date_fin))) {
            return res.status(400).json({ error: 'periode.annee ou (periode.date_debut + periode.date_fin) requis' });
        }
        const pdf = await generateAttestationCA({
            client: body.client,
            periode: body.periode,
            montant_ca: Number(body.montant_ca),
            ville_emission: body.ville_emission || 'Boulogne',
            date_emission: body.date_emission || new Date(),
            cabinet: body.cabinet || {},
        });
        const raison = String(body.client.raison_sociale || 'client').replace(/[^a-zA-Z0-9]+/g, '_');
        const label = body.periode.annee || `${body.periode.date_debut}_${body.periode.date_fin}`;
        const filename = `Attestation_CA_${raison}_${label}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(pdf);
    } catch (err) {
        console.error('[attestation-ca]', err);
        return res.status(500).json({ error: String(err && err.message || err) });
    }
});

app.use(express.static(SITE_ROOT));

async function warmSynthesisCache() {
    const today = new Date();
    const year = today.getUTCFullYear();
    const pairs = [
        [year, year - 1],
        [year - 1, year - 2]
    ];

    // 1) Dossiers clients RÉELLEMENT actifs (avec company_id Pennylane + statut active)
    // Évite de pré-cacher les 50+ dossiers importés en pending_invitation qui n'ont pas
    // encore d'utilisateur — sinon on hit le rate-limit Pennylane (429) inutilement.
    let activeClients = [];
    try {
        const { data } = await supabase
            .from('clients')
            .select('id, raison_sociale, pennylane_company_id, pennylane_api_key, statut')
            .not('pennylane_company_id', 'is', null)
            .eq('statut', 'active');
        activeClients = data || [];
    } catch (err) {
        console.warn('[synth] warm: failed to list clients:', err.message || err);
    }

    const firmToken = await getSecret('pennylane_firm_token');

    // 2) Legacy : société par défaut (pour l'admin/dashboard sans auth)
    const legacyCompanyKey = (await getSecret('pennylane_company_id')) || 'default';
    for (const [y, c] of pairs) {
        const key = `${legacyCompanyKey}-${y}-${c}-${todayIso()}`;
        if (synthRefreshing.has(key)) continue;
        try {
            const data = await buildSynthesis(y, c);
            synthCache.set(key, { at: Date.now(), data });
            console.log(`[synth] warmed ${key} (legacy)`);
        } catch (e) {
            console.warn(`[synth] warm ${key} legacy failed:`, e.message || e);
        }
    }

    // 3) Un cache dédié par client actif — espacés pour éviter le rate-limit Pennylane
    for (const client of activeClients) {
        const apiKey = client.pennylane_api_key || firmToken;
        if (!apiKey) continue;
        const ctx = { apiKey, companyId: client.pennylane_company_id, clientProfile: client };
        for (const [y, c] of pairs) {
            const key = `${client.pennylane_company_id}-${y}-${c}-${todayIso()}`;
            // Skip si déjà en cache et frais (< 30 min) — évite de re-fetch inutilement
            const existing = synthCache.get(key);
            if (existing && (Date.now() - existing.at) < 30 * 60 * 1000) continue;
            if (synthRefreshing.has(key)) continue;
            try {
                const data = await plContext.run(ctx, () => buildSynthesis(y, c));
                synthCache.set(key, { at: Date.now(), data });
                console.log(`[synth] warmed ${key} (${client.raison_sociale})`);
            } catch (e) {
                console.warn(`[synth] warm ${key} (${client.raison_sociale}) failed:`, e.message || e);
            }
            // Pause 800ms entre paires d'années pour ne pas hit le rate-limit
            await sleep(800);
        }
        // Pré-fetch endpoints courants — séquentiel + délai
        try {
            await plContext.run(ctx, async () => {
                const ba = await pl('/bank_accounts', { query: { per_page: 50 } });
                if (ba.ok) plResponseCache.set(`${client.pennylane_company_id}:/api/pennylane/bank-accounts`, { at: Date.now(), body: JSON.stringify(ba.body) });
                await sleep(400);
                const tx = await pl('/transactions', { query: { limit: 50 } });
                if (tx.ok) plResponseCache.set(`${client.pennylane_company_id}:/api/pennylane/transactions?limit=50`, { at: Date.now(), body: JSON.stringify(tx.body) });
            });
            console.log(`[prefetch] transactions+banks for ${client.raison_sociale}`);
        } catch (e) {
            console.warn(`[prefetch] failed for ${client.raison_sociale}:`, e.message || e);
        }
        // Pause 1.5s entre dossiers (laisse Pennylane respirer)
        await sleep(1500);
    }
    persistSynthesisCache();
}

app.listen(PORT, () => {
    console.log(`[cedrus-site] http://localhost:${PORT}`);
    getSecret('pennylane_company_id').then(cid => {
        console.log(`[pennylane] company ${PENNYLANE_COMPANY_NAME} (id ${cid || 'not set'})`);
    }).catch(() => {});
    // Warm the cache in background — démarre 5s après le boot pour ne pas saturer
    setTimeout(() => warmSynthesisCache().catch(() => {}), 5000);
    // Refresh every 10 min en arrière-plan (plus 2 min — Pennylane rate-limit nous mettait en 429)
    setInterval(() => warmSynthesisCache().catch(() => {}), 10 * 60 * 1000);
    // Purge automatique des leads rejetés depuis plus d'1 an (RGPD)
    purgeOldRejectedLeads().catch(() => {});
    setInterval(() => purgeOldRejectedLeads().catch(() => {}), 24 * 60 * 60 * 1000);
});

// Purge automatique : supprime les leads avec statut='rejected' inchangés depuis 1 an.
// Conformité CNIL pour la conservation des données de prospection commerciale.
async function purgeOldRejectedLeads() {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    try {
        const { data, error } = await supabase
            .from('leads')
            .delete()
            .eq('statut', 'rejected')
            .lt('updated_at', oneYearAgo)
            .select('id, email');
        if (error) {
            console.warn('[purge-leads] failed:', error.message);
            return;
        }
        if (data && data.length > 0) {
            console.log(`[purge-leads] supprimé ${data.length} prospect(s) rejeté(s) depuis plus d'1 an`);
        }
    } catch (e) {
        console.warn('[purge-leads] exception:', e.message);
    }
}
