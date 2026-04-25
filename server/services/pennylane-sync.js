// ============================================================================
// Synchronisation de documents clients vers Pennylane — via EMAIL dédié
// ============================================================================
// Pennylane fournit 2 adresses email par dossier :
//  - xxx@suppliers.pennylane.com  → factures d'achat (OCR auto)
//  - xxx@customers.pennylane.com  → factures de vente
// On envoie le PDF en pièce jointe → Pennylane importe automatiquement.
// ============================================================================

import { supabase } from './supabase.js';
import { sendMailWithAttachment, isSmtpConfigured } from './mailer.js';

const CATEGORY_MAP = {
    'facture-achat': { emailField: 'pennylane_email_suppliers', label: 'supplier' },
    'facture-vente': { emailField: 'pennylane_email_customers', label: 'customer' }
};

export function shouldSyncToPennylane(category) {
    return !!CATEGORY_MAP[category];
}

/**
 * Envoie un document à Pennylane par email.
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function syncDocToPennylane({ doc, client }) {
    const mapping = CATEGORY_MAP[doc.category];
    if (!mapping) return { ok: false, error: 'category_not_syncable' };

    const targetEmail = client[mapping.emailField];
    if (!targetEmail) {
        return { ok: false, error: `missing_pennylane_email_${mapping.label}` };
    }
    if (!(await isSmtpConfigured())) {
        return { ok: false, error: 'smtp_not_configured' };
    }

    try {
        // Télécharge le fichier depuis Supabase Storage
        const { data: fileBlob, error: dlErr } = await supabase.storage
            .from('client-docs')
            .download(doc.storage_path);
        if (dlErr || !fileBlob) {
            return { ok: false, error: 'storage_download_failed: ' + (dlErr?.message || 'no file') };
        }
        const buffer = Buffer.from(await fileBlob.arrayBuffer());

        const subject = mapping.label === 'supplier'
            ? `Facture fournisseur — ${client.raison_sociale}`
            : `Facture client — ${client.raison_sociale}`;
        const body = `Document déposé via l'espace client CEDRUS par ${client.raison_sociale}.\n\nNom original : ${doc.name}\nDate de dépôt : ${new Date(doc.uploaded_at || Date.now()).toLocaleString('fr-FR')}\n${doc.note ? '\nNote : ' + doc.note : ''}`;

        const result = await sendMailWithAttachment({
            to: targetEmail,
            subject,
            text: body,
            attachments: [{
                filename: doc.name,
                content: buffer,
                contentType: doc.mime_type || 'application/pdf'
            }]
        });
        return result;
    } catch (err) {
        return { ok: false, error: 'exception: ' + String(err.message || err) };
    }
}

/**
 * Lance la synchronisation en arrière-plan d'un document et met à jour la table.
 */
export async function syncDocBackground({ docId, category, clientId }) {
    if (!shouldSyncToPennylane(category)) return;

    const { data: doc } = await supabase
        .from('client_documents').select('*').eq('id', docId).maybeSingle();
    if (!doc) return;

    const { data: client } = await supabase
        .from('clients')
        .select('raison_sociale, pennylane_email_suppliers, pennylane_email_customers')
        .eq('id', clientId)
        .maybeSingle();
    if (!client) return;

    await supabase.from('client_documents').update({
        pennylane_status: 'syncing',
        pennylane_error: null
    }).eq('id', docId);

    const result = await syncDocToPennylane({ doc, client });

    if (result.ok) {
        await supabase.from('client_documents').update({
            pennylane_status: 'synced',
            pennylane_synced_at: new Date().toISOString(),
            pennylane_endpoint: CATEGORY_MAP[category].label,
            pennylane_doc_id: result.messageId || null,
            pennylane_error: null
        }).eq('id', docId);
        console.log(`[pl-sync] ✓ doc ${docId} envoyé par email (id=${result.messageId})`);

        // Suppression du fichier de Supabase Storage — archive désormais chez Pennylane
        try {
            const { error: rmErr } = await supabase.storage.from('client-docs').remove([doc.storage_path]);
            if (rmErr) {
                console.warn(`[pl-sync] suppression Storage échouée pour ${docId}:`, rmErr.message);
            } else {
                await supabase.from('client_documents').update({
                    storage_deleted_at: new Date().toISOString()
                }).eq('id', docId);
                console.log(`[pl-sync] ↳ fichier supprimé de Supabase Storage (archivé chez Pennylane)`);
            }
        } catch (e) {
            console.warn(`[pl-sync] exception suppression Storage ${docId}:`, e.message);
        }
    } else {
        await supabase.from('client_documents').update({
            pennylane_status: 'failed',
            pennylane_error: result.error.slice(0, 500)
        }).eq('id', docId);
        console.warn(`[pl-sync] ✗ doc ${docId} : ${result.error}`);
    }
}
