// ============================================================================
// Sirene enrichment — recherche-entreprises.api.gouv.fr
// Gratuit, sans auth, données officielles INSEE
// ============================================================================

import { libelleNAF } from './naf.js';

const SIRENE_BASE = 'https://recherche-entreprises.api.gouv.fr/search';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Codes INSEE (nature_juridique) → libellés courts
// Ref : https://www.insee.fr/fr/information/2028129
const FORMES_JURIDIQUES = {
    '1000': 'Entreprise individuelle',
    '5202': 'Société en nom collectif',
    '5203': 'Société en nom collectif',
    '5306': 'Société en commandite simple',
    '5385': 'SA à conseil d\'administration',
    '5410': 'SARL (gérant majoritaire)',
    '5415': 'SARL (gérant minoritaire)',
    '5422': 'SARL immobilière (construction vente)',
    '5426': 'SARL immobilière de gestion',
    '5430': 'SARL de presse',
    '5431': 'SARL',
    '5432': 'SARL d\'économie mixte',
    '5442': 'EARL',
    '5443': 'SARL coopérative',
    '5498': 'EURL',
    '5499': 'SARL',
    '5505': 'SA à participation ouvrière',
    '5510': 'SA coopérative de production',
    '5515': 'SA d\'intérêt collectif agricole',
    '5520': 'SA d\'HLM',
    '5532': 'SA d\'économie mixte',
    '5547': 'SA coopérative de consommation',
    '5552': 'SA coopérative agricole',
    '5558': 'SA coopérative ouvrière',
    '5559': 'SA',
    '5560': 'SA coopérative de crédit',
    '5599': 'SA à directoire',
    '5605': 'SA d\'expertise comptable',
    '5630': 'SA de presse',
    '5631': 'SA de presse à directoire',
    '5650': 'SA à conseil d\'administration (DOM)',
    '5699': 'SA',
    '5710': 'SAS',
    '5720': 'SASU',
    '5785': 'Société d\'exercice libéral par actions simplifiée (SELAS)',
    '5800': 'Société européenne',
    '6100': 'Caisse d\'épargne et prévoyance',
    '6316': 'Coopérative d\'utilisation de matériel agricole',
    '6317': 'Société coopérative agricole',
    '6318': 'Union de sociétés coopératives agricoles',
    '6411': 'Société d\'assurance à forme mutuelle',
    '6511': 'Société civile de placement collectif immobilier',
    '6521': 'Société civile d\'intérêt collectif agricole',
    '6532': 'Groupement agricole d\'exploitation en commun',
    '6533': 'Groupement foncier agricole',
    '6534': 'Groupement agricole foncier',
    '6535': 'Groupement forestier',
    '6539': 'Groupement foncier et rural',
    '6540': 'SCI',
    '6541': 'Société civile de construction vente',
    '6542': 'Société civile d\'exploitation agricole',
    '6543': 'Société civile laitière',
    '6551': 'Société civile coopérative de consommation',
    '6554': 'Société civile coopérative entre médecins',
    '6558': 'Société civile de moyens',
    '6560': 'Société civile',
    '6561': 'SCP d\'avocats',
    '6562': 'SCP d\'avocats aux conseils',
    '6563': 'SCP d\'avoués d\'appel',
    '6564': 'SCP d\'huissiers',
    '6565': 'SCP de notaires',
    '6566': 'SCP de commissaires-priseurs',
    '6567': 'SCP de greffiers de tribunal de commerce',
    '6568': 'SCP de conseils juridiques',
    '6569': 'SCP de commissaires aux comptes',
    '6571': 'SCP de médecins',
    '6572': 'SCP de dentistes',
    '6573': 'SCP d\'infirmiers',
    '6574': 'SCP de masseurs-kinésithérapeutes',
    '6575': 'SCP de directeurs de laboratoire d\'analyse médicale',
    '6576': 'SCP de vétérinaires',
    '6577': 'SCP de géomètres experts',
    '6578': 'SCP d\'architectes',
    '6585': 'SCEP',
    '6588': 'Société civile laitière',
    '6589': 'Société civile de moyens',
    '6599': 'Société civile',
    '6901': 'Autre personne de droit privé inscrite au RCS',
    '7321': 'Établissement public national à caractère industriel ou commercial'
};

export function libelleFormeJuridique(code) {
    if (!code) return null;
    return FORMES_JURIDIQUES[String(code).padStart(4, '0')] || `Code ${code}`;
}

export async function enrichFromSirene(siren) {
    const digits = String(siren || '').replace(/\D/g, '');
    if (digits.length !== 9) return null;

    let json = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const url = `${SIRENE_BASE}?q=${digits}&per_page=1`;
            const res = await fetch(url);
            if (res.ok) {
                json = await res.json();
                break;
            }
            if (res.status === 429 || res.status >= 500) {
                await sleep(500 * (attempt + 1));
                continue;
            }
            console.warn('[sirene] HTTP', res.status, 'for', digits);
            return null;
        } catch (err) {
            console.warn('[sirene] fetch failed (attempt ' + attempt + '):', err.message);
            await sleep(500 * (attempt + 1));
        }
    }
    if (!json) return null;

    const result = (json?.results || [])[0];
    if (!result) return null;

    const siege = result.siege || {};
    const dirigeants = result.dirigeants || [];
    const dirigeant = dirigeants.length > 0
        ? [dirigeants[0].prenoms, dirigeants[0].nom].filter(Boolean).join(' ').trim()
        : null;

    return {
        raison_sociale: result.nom_complet || result.nom_raison_sociale || null,
        siren: result.siren || digits,
        siret: siege.siret || null,
        forme_juridique: libelleFormeJuridique(result.nature_juridique) || result.nature_juridique || null,
        forme_juridique_code: result.nature_juridique || null,
        adresse: siege.adresse || null,
        code_postal: siege.code_postal || null,
        ville: siege.libelle_commune || null,
        code_naf: siege.activite_principale || result.activite_principale || null,
        activite: libelleNAF(siege.activite_principale || result.activite_principale) || null,
        dirigeant,
        dirigeants: dirigeants.map(d => ({
            prenom: d.prenoms || '',
            nom: d.nom || '',
            qualite: d.qualite || '',
            date_naissance: d.date_de_naissance || ''
        })),
        date_creation: result.date_creation || siege.date_creation || null,
        effectif: siege.tranche_effectif_salarie || null,
        categorie: result.categorie_entreprise || null
    };
}
