// ============================================================================
// Pappers — recherche d'une entreprise par SIREN/SIRET
// ----------------------------------------------------------------------------
// Données plus riches que recherche-entreprises.api.gouv.fr (INSEE) :
// dirigeants à jour, BODACC, comptes annuels, bénéficiaires effectifs.
// La clé API est lue depuis api_credentials (admin → Paramètres & Connexions).
// Si pas de clé configurée → fallback sur INSEE recherche-entreprises.
// ============================================================================

import { getSecret } from './secrets.js';
import { libelleNAF } from './naf.js';

const PAPPERS_BASE = 'https://api.pappers.fr/v2';

// Normalise une réponse Pappers vers le shape attendu par le frontend onboarding
// (mêmes clés que recherche-entreprises.api.gouv.fr → aucune adaptation côté UI)
function normalizePappersResponse(p) {
    if (!p || !p.siren) return null;
    const siege = p.siege || {};
    const adresse = [siege.adresse_ligne_1, siege.adresse_ligne_2].filter(Boolean).join(' ').trim()
        || siege.adresse_complete
        || '';
    const dirigeants = (p.representants || []).map(r => ({
        prenom: r.prenom || '',
        nom: r.nom || '',
        qualite: r.qualite || ''
    }));
    return {
        nom_complet: p.nom_entreprise || p.denomination || '',
        siren: p.siren,
        siege: {
            siret: siege.siret || (p.siren + (siege.numero_etablissement || '00000')),
            adresse,
            code_postal: siege.code_postal || '',
            ville: siege.ville || '',
            date_creation: siege.date_creation || ''
        },
        activite_principale: p.code_naf || p.naf || '',
        libelle_activite_principale: p.libelle_code_naf || libelleNAF(p.code_naf) || '',
        nature_juridique: p.forme_juridique || '',
        dirigeants,
        date_creation: p.date_creation || '',
        _source: 'pappers'
    };
}

// Recherche par SIREN (9 chiffres) ou SIRET (14 chiffres → on garde les 9 premiers)
export async function pappersLookup(sirenOrSiret) {
    const apiKey = await getSecret('pappers_api_key');
    if (!apiKey) return null;

    const digits = String(sirenOrSiret || '').replace(/\D/g, '');
    if (digits.length < 9) return null;
    const siren = digits.slice(0, 9);

    const url = PAPPERS_BASE + '/entreprise?siren=' + siren + '&api_token=' + encodeURIComponent(apiKey);
    try {
        const r = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!r.ok) {
            console.warn('[pappers] HTTP', r.status, 'pour SIREN', siren);
            return null;
        }
        const data = await r.json();
        return normalizePappersResponse(data);
    } catch (e) {
        console.warn('[pappers] erreur:', e.message);
        return null;
    }
}

// Fallback INSEE — même shape que Pappers normalisé
async function inseeLookup(sirenOrSiret) {
    const digits = String(sirenOrSiret || '').replace(/\D/g, '');
    if (!digits) return null;
    try {
        const r = await fetch('https://recherche-entreprises.api.gouv.fr/search?q=' + digits + '&per_page=1');
        if (!r.ok) return null;
        const data = await r.json();
        const result = (data.results || [])[0];
        if (!result) return null;
        result._source = 'insee';
        return result;
    } catch (e) {
        console.warn('[insee] erreur:', e.message);
        return null;
    }
}

// Lookup unifié : Pappers en priorité, INSEE en fallback
export async function lookupCompany(sirenOrSiret) {
    const fromPappers = await pappersLookup(sirenOrSiret);
    if (fromPappers) return fromPappers;
    return await inseeLookup(sirenOrSiret);
}
