// ============================================================================
// Silae Import — parse un ZIP de bulletins de paie et les dispatche dans
// les dossiers clients CEDRUS (Supabase Storage + table client_documents)
// ============================================================================
// Stratégies de détection du salarié/client :
//   1. Match par nom de fichier (ex: "DURAND_Jean_EXEMPLE_SAS_202612.pdf")
//   2. Match par texte dans le PDF (raison sociale + nom salarié)
//   3. Match par arborescence ZIP (ex: "EXEMPLE SAS/DURAND_Jean/12-2026.pdf")
// Si aucun match automatique → fichier renvoyé en "à classer manuellement"
// ============================================================================

import AdmZip from 'adm-zip';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import crypto from 'node:crypto';
import path from 'node:path';
import { supabase } from './supabase.js';

// Normalise une chaîne : enlève accents, met en minuscules, supprime caractères spéciaux
function normalize(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Extrait nom/prénom depuis un texte PDF (patterns Silae)
// Exemples : "Mr DURAND Jean", "Mme MARTIN Sophie", "NOM : DURAND   Prénom : Jean"
function extractNameFromPdfText(text) {
    if (!text) return null;
    const lines = text.split(/\n/).slice(0, 30); // 30 premières lignes
    for (const line of lines) {
        // Pattern 1: NOM : XXX  Prénom : YYY
        let m = line.match(/nom[\s:\-]+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\']{1,30})[\s,\/]+pr[eé]nom[\s:\-]+([A-ZÀ-Ÿ][a-zà-ÿ\-\']{1,30})/i);
        if (m) return { nom: m[1].trim(), prenom: m[2].trim() };
        // Pattern 2: M./Mme/Mr/Mlle NOM Prénom
        m = line.match(/(?:M\.?|Mme|Mr|Mlle)\s+([A-ZÀ-Ÿ][A-ZÀ-Ÿ\-\']{1,30})\s+([A-ZÀ-Ÿ][a-zà-ÿ\-\']{1,30})/);
        if (m) return { nom: m[1].trim(), prenom: m[2].trim() };
    }
    return null;
}

// Extrait année + mois d'un nom de fichier (ex: "202612", "12-2026", "dec-2026")
function extractPeriod(filename) {
    const moisMap = { jan: 1, feb: 2, fev: 2, mar: 3, avr: 4, apr: 4, mai: 5, may: 5, jun: 6, juin: 6, jul: 7, juil: 7, aug: 8, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const n = normalize(filename);

    // YYYYMM ou YYYYMMDD
    let m = n.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/);
    if (m) return { year: m[1], month: m[2] };

    // MM-YYYY ou MM/YYYY ou M_YYYY
    m = n.match(/\b(0?[1-9]|1[0-2])[\s\-_](20\d{2})\b/);
    if (m) return { year: m[2], month: m[1].padStart(2, '0') };

    // MMM YYYY (ex: "dec 2026")
    for (const [k, v] of Object.entries(moisMap)) {
        const re = new RegExp('\\b' + k + '\\w*\\s+(20\\d{2})', 'i');
        const x = n.match(re);
        if (x) return { year: x[1], month: String(v).padStart(2, '0') };
    }

    return null;
}

/**
 * Analyse un ZIP et renvoie la liste des bulletins détectés + matching.
 * Ne persiste rien — pour la preview uniquement.
 */
export async function previewSilaeZip(zipBuffer) {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.pdf'));

    // Charger tous les clients + salariés en mémoire pour matching
    const { data: clients } = await supabase
        .from('clients')
        .select('id, raison_sociale');
    const { data: salaries } = await supabase
        .from('client_salaries')
        .select('id, client_id, prenom, nom');

    const results = [];
    for (const entry of entries) {
        const filePath = entry.entryName;
        const fileName = path.basename(filePath);
        const folderPath = path.dirname(filePath);
        const nNorm = normalize(fileName);
        const folderNorm = normalize(folderPath);
        const fullNorm = normalize(filePath);

        // 1. Match client par raison sociale (dans le chemin complet)
        let matchedClient = null;
        for (const c of (clients || [])) {
            const rsNorm = normalize(c.raison_sociale);
            if (rsNorm && (fullNorm.includes(rsNorm) || folderNorm.includes(rsNorm))) {
                matchedClient = c;
                break;
            }
        }

        // 2. Match salarié par nom + prénom (dans le nom de fichier ou chemin)
        let matchedSalarie = null;
        const candidates = matchedClient
            ? (salaries || []).filter(s => s.client_id === matchedClient.id)
            : (salaries || []);
        for (const s of candidates) {
            const nomN = normalize(s.nom);
            const prenomN = normalize(s.prenom);
            if (nomN && prenomN && (fullNorm.includes(nomN) && fullNorm.includes(prenomN))) {
                matchedSalarie = s;
                if (!matchedClient) {
                    matchedClient = (clients || []).find(c => c.id === s.client_id) || null;
                }
                break;
            }
        }

        // 3. Si pas de match salarié, lire le contenu PDF pour match ou création auto
        let pdfText = null;
        let detectedName = null;
        if (!matchedSalarie) {
            try {
                const buf = entry.getData();
                const parsed = await pdfParse(buf, { max: 1 });
                pdfText = parsed.text || '';
                const pdfNorm = normalize(pdfText);

                // Match client via le texte
                if (!matchedClient) {
                    for (const c of (clients || [])) {
                        const rsNorm = normalize(c.raison_sociale);
                        if (rsNorm && pdfNorm.includes(rsNorm)) {
                            matchedClient = c;
                            break;
                        }
                    }
                }

                // Match salarié via le texte (parmi ceux du client matché)
                const pdfCandidates = matchedClient
                    ? (salaries || []).filter(s => s.client_id === matchedClient.id)
                    : (salaries || []);
                for (const s of pdfCandidates) {
                    const nomN = normalize(s.nom);
                    const prenomN = normalize(s.prenom);
                    if (nomN && prenomN && pdfNorm.includes(nomN) && pdfNorm.includes(prenomN)) {
                        matchedSalarie = s;
                        if (!matchedClient) {
                            matchedClient = (clients || []).find(c => c.id === s.client_id) || null;
                        }
                        break;
                    }
                }

                // Si toujours pas matché, tenter d'extraire le nom pour création auto
                if (!matchedSalarie) {
                    detectedName = extractNameFromPdfText(pdfText);
                }
            } catch (e) {
                // PDF illisible, on passe
            }
        }

        const period = extractPeriod(fileName) || extractPeriod(folderPath);

        let status;
        if (matchedSalarie) {
            status = 'auto';
        } else if (matchedClient && detectedName) {
            status = 'create_salarie'; // nouveau salarié à créer
        } else if (matchedClient) {
            status = 'client_only';
        } else {
            status = 'unmatched';
        }

        results.push({
            filePath,
            fileName,
            size: entry.header.size,
            matchedClient: matchedClient ? { id: matchedClient.id, raison_sociale: matchedClient.raison_sociale } : null,
            matchedSalarie: matchedSalarie ? {
                id: matchedSalarie.id,
                client_id: matchedSalarie.client_id,
                prenom: matchedSalarie.prenom,
                nom: matchedSalarie.nom
            } : null,
            detectedName, // {prenom, nom} si détecté dans le PDF pour création auto
            period,
            status
        });
    }

    return {
        totalFiles: entries.length,
        matched: results.filter(r => r.status === 'auto').length,
        toCreate: results.filter(r => r.status === 'create_salarie').length,
        clientOnly: results.filter(r => r.status === 'client_only').length,
        unmatched: results.filter(r => r.status === 'unmatched').length,
        items: results
    };
}

/**
 * Importe effectivement les bulletins dans Supabase Storage + client_documents.
 * @param items {Array} Items validés par l'admin (avec matchedSalarie défini)
 */
export async function importSilaeZip(zipBuffer, items, { uploadedBy } = {}) {
    const zip = new AdmZip(zipBuffer);
    const results = { ok: 0, skipped: 0, errors: [] };

    for (const item of items) {
        if (!item.matchedClient) {
            results.skipped++;
            results.errors.push({ file: item.fileName, reason: 'missing_client' });
            continue;
        }

        // Auto-création du salarié si "create_salarie"
        let salarieId = item.matchedSalarie?.id || null;
        if (!salarieId && item.detectedName && item.matchedClient) {
            const { data: existing } = await supabase
                .from('client_salaries')
                .select('id')
                .eq('client_id', item.matchedClient.id)
                .ilike('nom', item.detectedName.nom)
                .ilike('prenom', item.detectedName.prenom)
                .maybeSingle();
            if (existing) {
                salarieId = existing.id;
            } else {
                const { data: newSal, error: salErr } = await supabase
                    .from('client_salaries')
                    .insert({
                        client_id: item.matchedClient.id,
                        prenom: item.detectedName.prenom,
                        nom: item.detectedName.nom,
                        created_by: uploadedBy || null
                    })
                    .select('id')
                    .single();
                if (salErr) {
                    results.skipped++;
                    results.errors.push({ file: item.fileName, reason: 'create_salarie_failed: ' + salErr.message });
                    continue;
                }
                salarieId = newSal.id;
                results.salariesCreated = (results.salariesCreated || 0) + 1;
            }
        }

        if (!salarieId) {
            results.skipped++;
            results.errors.push({ file: item.fileName, reason: 'no_salarie_match' });
            continue;
        }

        const entry = zip.getEntry(item.filePath);
        if (!entry) {
            results.skipped++;
            results.errors.push({ file: item.fileName, reason: 'entry_not_found' });
            continue;
        }

        try {
            const buffer = entry.getData();
            const docId = crypto.randomUUID();
            const ext = path.extname(item.fileName) || '.pdf';
            const storagePath = `${item.matchedClient.id}/${docId}${ext}`;

            const { error: upErr } = await supabase.storage
                .from('client-docs')
                .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
            if (upErr) {
                results.skipped++;
                results.errors.push({ file: item.fileName, reason: 'storage: ' + upErr.message });
                continue;
            }

            const period = item.period ? item.period.year : null;
            const periodMonth = item.period ? item.period.month : null;

            const row = {
                id: docId,
                client_id: item.matchedClient.id,
                salarie_id: salarieId,
                name: item.fileName,
                category: 'social',
                permanent_key: 'fiche_paie',
                period,
                period_month: periodMonth,
                size_bytes: buffer.length,
                mime_type: 'application/pdf',
                storage_path: storagePath,
                uploaded_by: uploadedBy || null,
                uploaded_by_role: 'cabinet',
                pennylane_status: 'not_applicable',
                source: 'silae_import'
            };

            const { error: dbErr } = await supabase.from('client_documents').insert(row);
            if (dbErr) {
                await supabase.storage.from('client-docs').remove([storagePath]);
                results.skipped++;
                results.errors.push({ file: item.fileName, reason: 'db: ' + dbErr.message });
                continue;
            }
            results.ok++;
        } catch (err) {
            results.skipped++;
            results.errors.push({ file: item.fileName, reason: String(err.message || err) });
        }
    }

    return results;
}
