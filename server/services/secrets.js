// ============================================================================
// Secrets — accès centralisé aux clés API stockées dans la table api_credentials
// ============================================================================
// Remplace les usages de process.env.PENNYLANE_*, process.env.SMTP_*, etc.
// Permet à l'admin de rotater les clés depuis l'UI sans redéploiement.
//
// Usage :
//     import { getSecret } from './secrets.js';
//     const token = await getSecret('pennylane_firm_token');
//
// Fallback : si la clé n'est pas dans la DB, on lit process.env en UPPER_CASE
// pour garder une compat rétroactive pendant la transition.
// ============================================================================

import { supabase } from './supabase.js';

// Cache mémoire : clé → { value, fetchedAt }
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 s

// Liste des clés autorisées + libellé UI + fallback env
export const SECRET_DEFS = {
    pennylane_firm_token: {
        label: 'Pennylane — Firm token',
        description: 'Token du cabinet CEDRUS (accès à tous les dossiers)',
        envFallback: 'PENNYLANE_FIRM_TOKEN',
        type: 'password',
        testable: true
    },
    pennylane_company_id: {
        label: 'Pennylane — Company ID par défaut',
        description: 'ID du dossier par défaut pour les routes admin sans contexte',
        envFallback: 'PENNYLANE_COMPANY_ID',
        type: 'text',
        testable: false
    },
    smtp_host: {
        label: 'SMTP — Host',
        description: "Serveur SMTP (ex: smtp.resend.com)",
        envFallback: 'SMTP_HOST',
        type: 'text',
        testable: false
    },
    smtp_port: {
        label: 'SMTP — Port',
        description: '465 pour SSL, 587 pour STARTTLS',
        envFallback: 'SMTP_PORT',
        type: 'text',
        testable: false
    },
    smtp_user: {
        label: 'SMTP — User',
        description: 'Ex: resend',
        envFallback: 'SMTP_USER',
        type: 'text',
        testable: false
    },
    smtp_pass: {
        label: 'SMTP — Password / API Key',
        description: 'Clé API Resend (re_…) ou mot de passe SMTP',
        envFallback: 'SMTP_PASS',
        type: 'password',
        testable: true
    },
    smtp_from: {
        label: 'SMTP — Expéditeur',
        description: 'Adresse From (doit être sur un domaine vérifié)',
        envFallback: 'SMTP_FROM',
        type: 'text',
        testable: false
    },
    pappers_api_key: {
        label: 'Pappers — API Key',
        description: 'Pour la recherche SIRET dans les formulaires onboarding',
        envFallback: 'PAPPERS_API_KEY',
        type: 'password',
        testable: true
    }
};

function maskLast4(value) {
    if (!value) return '';
    const s = String(value);
    return s.length > 4 ? s.slice(-4) : s;
}

/**
 * Lit un secret depuis la DB (avec cache 60s) puis fallback env var.
 * @returns {Promise<string|null>}
 */
export async function getSecret(key) {
    if (!SECRET_DEFS[key]) {
        console.warn(`[secrets] clé inconnue: ${key}`);
    }

    const cached = cache.get(key);
    if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
        return cached.value;
    }

    let value = null;
    try {
        const { data } = await supabase
            .from('api_credentials')
            .select('value')
            .eq('key', key)
            .maybeSingle();
        if (data?.value) value = data.value;
    } catch (e) {
        console.warn(`[secrets] lecture DB échouée pour ${key}:`, e.message);
    }

    // Fallback env (rétrocompat pendant la migration)
    if (!value) {
        const envName = SECRET_DEFS[key]?.envFallback;
        if (envName && process.env[envName]) value = process.env[envName];
    }

    cache.set(key, { value, fetchedAt: Date.now() });
    return value;
}

/**
 * Écrit un secret dans la DB et invalide le cache.
 * Si value est vide/null → supprime l'entrée.
 */
export async function setSecret(key, value, { updatedBy } = {}) {
    if (!SECRET_DEFS[key]) throw new Error(`clé non autorisée: ${key}`);

    cache.delete(key);

    const trimmed = String(value || '').trim();
    if (!trimmed) {
        const { error } = await supabase.from('api_credentials').delete().eq('key', key);
        if (error) throw error;
        return { key, deleted: true };
    }

    const row = {
        key,
        value: trimmed,
        last4: maskLast4(trimmed),
        description: SECRET_DEFS[key].description || null,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy || null
    };
    const { error } = await supabase.from('api_credentials').upsert(row, { onConflict: 'key' });
    if (error) throw error;
    return { key, last4: row.last4, updated_at: row.updated_at };
}

/**
 * Renvoie la liste des secrets pour l'UI admin — masqués (last4 uniquement).
 */
export async function listSecretsMasked() {
    const { data } = await supabase
        .from('api_credentials')
        .select('key, last4, updated_at, updated_by');

    const byKey = new Map((data || []).map(r => [r.key, r]));
    const items = [];
    for (const [key, def] of Object.entries(SECRET_DEFS)) {
        const row = byKey.get(key);
        const envFallback = def.envFallback && process.env[def.envFallback] ? true : false;
        items.push({
            key,
            label: def.label,
            description: def.description,
            type: def.type,
            testable: def.testable,
            configured: !!row,
            last4: row?.last4 || null,
            updated_at: row?.updated_at || null,
            updated_by: row?.updated_by || null,
            // Si pas configuré en DB mais présent en env, on affiche 'env' pour que JF sache
            envFallbackPresent: envFallback
        });
    }
    return items;
}

export function invalidateSecretCache(key) {
    if (key) cache.delete(key);
    else cache.clear();
}
