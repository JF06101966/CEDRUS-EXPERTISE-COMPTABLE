// ============================================================================
// Pennylane API wrapper — supporte une clé API différente par client
// ============================================================================
// Chaque client a SA propre clé API Pennylane stockée dans clients.pennylane_api_key
// Les routes client utilisent cette clé. Les routes admin (dashboard cabinet) peuvent
// utiliser une clé firm globale si elle existe, mais le modèle principal reste
// "une clé par client".
// ============================================================================

const PL_BASE = 'https://app.pennylane.com/api/external/v2';

const sleep = (ms) => new Promise(ok => setTimeout(ok, ms));

// Un appel Pennylane générique, avec retry pour les 429/5xx
export async function pl(endpoint, { apiKey, companyId, query = {}, method = 'GET', body = null } = {}) {
    if (!apiKey) throw new Error('pennylane: missing apiKey');

    const url = new URL(PL_BASE + endpoint);
    for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
    };
    if (companyId) headers['X-Company-Id'] = String(companyId);
    if (body) headers['Content-Type'] = 'application/json';

    const init = { method, headers };
    if (body) init.body = JSON.stringify(body);

    const res = await fetch(url, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, body: data };
}

// Pagination par cursor avec retry
export async function plAll(endpoint, { apiKey, companyId, query = {}, maxPages = 50, debugTag = '' } = {}) {
    let items = [];
    let cursor = null;

    for (let i = 0; i < maxPages; i++) {
        const q = { ...query };
        if (cursor) q.cursor = cursor;

        let r;
        for (let attempt = 0; attempt < 4; attempt++) {
            r = await pl(endpoint, { apiKey, companyId, query: q });
            if (r.ok) break;
            if (r.status === 429 || r.status >= 500) {
                await sleep(600 * (attempt + 1));
                continue;
            }
            break;
        }
        if (!r.ok) return { ok: false, status: r.status, body: r.body };

        const page = r.body?.items || [];
        items = items.concat(page);
        cursor = r.body?.next_cursor || null;
        if (!cursor) break;
    }

    return { ok: true, items };
}
