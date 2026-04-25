// ============================================================================
// Caches Pennylane partagés entre index.js et les routes admin
// ----------------------------------------------------------------------------
// Permet de tout purger d'un coup quand un admin met à jour le firm token
// (sinon les anciennes réponses restent servies jusqu'à expiration TTL).
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYNTH_CACHE_PATH = path.join(__dirname, '..', 'uploads', 'synthesis-cache.json');

// Cache générique des réponses Pennylane GET (clé = companyId:url)
export const plResponseCache = new Map();

// Cache de synthèse (KPIs + charts) — persisté sur disque
export const synthCache = new Map();
export const synthRefreshing = new Set();

export function persistSynthesisCache() {
    try {
        const obj = {};
        for (const [k, v] of synthCache.entries()) obj[k] = v;
        fs.writeFileSync(SYNTH_CACHE_PATH, JSON.stringify(obj));
    } catch (e) {
        console.warn('[synth] failed to persist cache:', e);
    }
}

export function loadSynthesisCacheFromDisk() {
    try {
        const raw = fs.readFileSync(SYNTH_CACHE_PATH, 'utf8');
        const obj = JSON.parse(raw);
        for (const [k, v] of Object.entries(obj)) synthCache.set(k, v);
        console.log(`[synth] loaded ${synthCache.size} cached entries from disk`);
    } catch {
        // no cache yet
    }
}

/**
 * Purge tous les caches Pennylane — mémoire + fichier disque.
 * Appelé quand l'admin change le firm token ou le company_id.
 */
export function purgePennylaneCaches() {
    const before = { pl: plResponseCache.size, synth: synthCache.size };
    plResponseCache.clear();
    synthCache.clear();
    synthRefreshing.clear();
    try { fs.unlinkSync(SYNTH_CACHE_PATH); } catch {}
    console.log(`[pl-cache] purged (plResponseCache=${before.pl}, synthCache=${before.synth})`);
    return before;
}
