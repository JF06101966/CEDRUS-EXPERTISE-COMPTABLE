import express from 'express';
import multer from 'multer';
import { supabase, supabaseAuthClient, logActivity } from '../services/supabase.js';
import { requireAdmin, requireRole } from '../services/auth.js';
import { pl } from '../services/pennylane.js';
import { enrichFromSirene } from '../services/sirene.js';
import { syncDocBackground, shouldSyncToPennylane } from '../services/pennylane-sync.js';
import { previewSilaeZip, importSilaeZip } from '../services/silae-import.js';
import { getSecret, setSecret, listSecretsMasked, SECRET_DEFS } from '../services/secrets.js';
import { sendMailWithAttachment } from '../services/mailer.js';
import { purgePennylaneCaches } from '../services/pl-cache.js';

// Upload générique admin (documents pour les clients)
import crypto from 'node:crypto';
import path from 'node:path';
const adminDocUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 } // 25 MB max par document
});

const silaeUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 } // 200 MB max pour un ZIP
});

const router = express.Router();

// ============================================================================
// SILAE — Import mensuel ZIP → dispatche bulletins dans les espaces clients
// ============================================================================
router.post('/api/admin/silae/preview', requireAdmin, silaeUpload.single('zip'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no_file' });
    try {
        const report = await previewSilaeZip(req.file.buffer);
        // Sauvegarde temporaire du ZIP pour l'import (en mémoire via key en session — simplifié : on renvoie le buffer en base64 — pas idéal pour gros ZIPs)
        // Alternative : stocker le ZIP dans Supabase Storage temporairement
        const tmpPath = `_tmp/silae-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`;
        const { error: upErr } = await supabase.storage
            .from('client-docs')
            .upload(tmpPath, req.file.buffer, { contentType: 'application/zip', upsert: false });
        if (upErr) return res.status(500).json({ error: 'temp_storage_failed', details: upErr.message });
        res.json({ ...report, tmpPath });
    } catch (err) {
        console.error('[silae/preview]', err);
        res.status(500).json({ error: 'preview_failed', details: String(err.message || err) });
    }
});

router.post('/api/admin/silae/import', requireAdmin, async (req, res) => {
    const { tmpPath, items } = req.body || {};
    if (!tmpPath || !Array.isArray(items)) return res.status(400).json({ error: 'missing_params' });

    try {
        const { data: fileBlob, error: dlErr } = await supabase.storage
            .from('client-docs').download(tmpPath);
        if (dlErr || !fileBlob) return res.status(500).json({ error: 'temp_fetch_failed' });
        const buffer = Buffer.from(await fileBlob.arrayBuffer());

        const result = await importSilaeZip(buffer, items, { uploadedBy: req.admin.id });

        // Nettoyage du ZIP temporaire
        await supabase.storage.from('client-docs').remove([tmpPath]);

        logActivity({
            actorUserId: req.admin.auth_user_id,
            actorRole: 'cabinet',
            action: 'silae.bulk_import',
            details: result
        });
        res.json(result);
    } catch (err) {
        console.error('[silae/import]', err);
        res.status(500).json({ error: 'import_failed', details: String(err.message || err) });
    }
});

// Helper : cherche un auth.user par email (pagination auth.admin)
async function findUserByEmail(email) {
    const lower = String(email || '').toLowerCase();
    if (!lower) return null;
    let page = 1;
    while (page <= 10) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return null;
        const users = data?.users || [];
        const found = users.find(u => (u.email || '').toLowerCase() === lower);
        if (found) return found;
        if (users.length < 200) break;
        page++;
    }
    return null;
}

// ============================================================================
// POST /api/admin/login — proxy login via Supabase Auth + vérif admin_users
// ----------------------------------------------------------------------------
// Permet au front de ne pas avoir besoin de la clé ANON Supabase.
// Renvoie { access_token, refresh_token, admin }.
// ============================================================================
router.post('/api/admin/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

        // Instance éphémère pour ne pas polluer le client data
        const authSb = supabaseAuthClient();
        const { data, error } = await authSb.auth.signInWithPassword({
            email: String(email).trim().toLowerCase(),
            password
        });
        if (error || !data?.session) {
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        const { data: admin, error: adminErr } = await supabase
            .from('admin_users')
            .select('*')
            .eq('auth_user_id', data.user.id)
            .eq('is_active', true)
            .maybeSingle();

        if (adminErr || !admin) {
            return res.status(403).json({ error: 'not_admin' });
        }

        logActivity({
            actorUserId: data.user.id,
            actorRole: 'cabinet',
            action: 'admin.login',
            details: { email: data.user.email }
        });

        res.json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
            admin: {
                id: admin.id,
                email: admin.email,
                prenom: admin.prenom,
                nom: admin.nom,
                role: admin.role
            }
        });
    } catch (err) {
        console.error('[admin.login]', err);
        res.status(500).json({ error: 'unexpected' });
    }
});

// ============================================================================
// POST /api/admin/request-password-reset — envoie un email de réinitialisation
// Ne révèle jamais si l'email existe réellement (anti-énumération)
// ============================================================================
router.post('/api/admin/request-password-reset', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'missing_email' });

        // Vérifie que c'est bien un admin (sinon pas d'email envoyé)
        const { data: admin } = await supabase
            .from('admin_users')
            .select('id, is_active')
            .eq('email', email)
            .eq('is_active', true)
            .maybeSingle();

        if (admin) {
            const redirectTo = (process.env.SITE_URL || 'http://localhost:8765') + '/admin-reset.html';
            const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
            if (error) {
                console.warn('[admin.reset] supabase error:', error.message);
            } else {
                logActivity({
                    actorRole: 'system',
                    action: 'admin.password_reset_requested',
                    details: { email }
                });
            }
        }

        // Toujours 200 pour ne pas révéler si l'email existe
        res.json({ ok: true });
    } catch (err) {
        console.error('[admin.request-password-reset]', err);
        res.json({ ok: true }); // idem : ne pas révéler d'info
    }
});

// ============================================================================
// POST /api/admin/set-new-password — finalise le reset après clic sur le lien
// Supporte 2 modes :
//  - { token_hash, type: 'recovery', new_password } : nouveau flow (verifyOtp)
//  - { access_token, new_password } : legacy implicit flow (getUser)
// ============================================================================
router.post('/api/admin/set-new-password', async (req, res) => {
    try {
        const { token_hash, type, access_token, new_password } = req.body || {};
        if (!new_password) return res.status(400).json({ error: 'missing_password' });
        if (new_password.length < 8) return res.status(400).json({ error: 'password_too_short' });

        const authSb = supabaseAuthClient();
        let user = null;

        if (token_hash) {
            // Nouveau flow : vérifie le token one-shot
            const { data, error } = await authSb.auth.verifyOtp({
                token_hash,
                type: type || 'recovery'
            });
            if (error || !data?.user) {
                console.warn('[set-new-password] verifyOtp failed:', error?.message);
                return res.status(401).json({ error: 'invalid_or_expired_token' });
            }
            user = data.user;
        } else if (access_token) {
            // Legacy : extraction du user depuis le token
            const { data, error } = await authSb.auth.getUser(access_token);
            if (error || !data?.user) return res.status(401).json({ error: 'invalid_or_expired_token' });
            user = data.user;
        } else {
            return res.status(400).json({ error: 'missing_token' });
        }

        // Vérifie que c'est bien un admin
        const { data: admin } = await supabase
            .from('admin_users')
            .select('id')
            .eq('auth_user_id', user.id)
            .eq('is_active', true)
            .maybeSingle();
        if (!admin) return res.status(403).json({ error: 'not_admin' });

        const { error: updErr } = await supabase.auth.admin.updateUserById(user.id, { password: new_password });
        if (updErr) return res.status(500).json({ error: 'password_update_failed', details: updErr.message });

        logActivity({
            actorUserId: user.id,
            actorRole: 'cabinet',
            action: 'admin.password_reset_completed',
            details: { email: user.email }
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[admin.set-new-password]', err);
        res.status(500).json({ error: 'unexpected' });
    }
});

// ============================================================================
// GET /api/admin/me — vérifie la session admin
// ============================================================================
router.get('/api/admin/me', requireAdmin, (req, res) => {
    res.json({
        id: req.admin.id,
        email: req.admin.email,
        prenom: req.admin.prenom,
        nom: req.admin.nom,
        role: req.admin.role
    });
});

// ============================================================================
// LEADS — liste + détail + update statut
// ============================================================================
router.get('/api/admin/leads', requireAdmin, async (req, res) => {
    const statut = req.query.statut;
    let q = supabase.from('leads').select('*').order('created_at', { ascending: false });
    if (statut && statut !== 'all') q = q.eq('statut', statut);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
});

router.get('/api/admin/leads/:id', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('leads')
        .select('*')
        .eq('id', req.params.id)
        .single();
    if (error) return res.status(404).json({ error: 'not_found' });
    res.json(data);
});

router.patch('/api/admin/leads/:id', requireAdmin, async (req, res) => {
    const allowed = ['statut', 'notes', 'assigned_to', 'contacted_at', 'signed_at', 'rejected_reason'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    if (patch.statut === 'contacted' && !patch.contacted_at) patch.contacted_at = new Date().toISOString();
    if (patch.statut === 'signed' && !patch.signed_at) patch.signed_at = new Date().toISOString();
    if (patch.statut === 'rejected') patch.rejected_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('leads')
        .update(patch)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'lead.updated',
        targetType: 'lead',
        targetId: req.params.id,
        details: patch
    });
    res.json(data);
});

// ============================================================================
// CLIENTS — liste + création + activation (envoi invitation)
// ============================================================================
router.get('/api/admin/clients', requireAdmin, async (req, res) => {
    const statut = req.query.statut;
    let q = supabase.from('clients').select('*').order('created_at', { ascending: false });
    if (statut && statut !== 'all') q = q.eq('statut', statut);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
});

router.get('/api/admin/clients/:id', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', req.params.id)
        .single();
    if (error) return res.status(404).json({ error: 'not_found' });
    // Masque la clé Pennylane dans la réponse API
    if (data) data.pennylane_api_key = data.pennylane_api_key ? '••••••••' : null;
    res.json(data);
});

// Crée un dossier client + envoie une invitation email (Supabase Auth magic link)
router.post('/api/admin/clients', requireAdmin, async (req, res) => {
    try {
        const b = req.body || {};
        const email = (b.contact_email || '').trim().toLowerCase();
        if (!email) return res.status(400).json({ error: 'missing_email' });
        if (!b.raison_sociale) return res.status(400).json({ error: 'missing_raison_sociale' });

        const row = {
            lead_id: b.lead_id || null,
            raison_sociale: b.raison_sociale,
            siren: b.siren || null,
            siret: b.siret || null,
            forme_juridique: b.forme_juridique || null,
            adresse: b.adresse || null,
            code_postal: b.code_postal || null,
            ville: b.ville || null,
            code_naf: b.code_naf || null,
            activite: b.activite || null,
            contact_email: email,
            contact_prenom: b.contact_prenom || null,
            contact_nom: b.contact_nom || null,
            contact_telephone: b.contact_telephone || null,
            pennylane_api_key: b.pennylane_api_key || null,
            pennylane_company_id: b.pennylane_company_id || null,
            chef_mission: b.chef_mission || req.admin.id,
            date_debut_mission: b.date_debut_mission || null,
            mission_compta: !!b.mission_compta,
            mission_social: !!b.mission_social,
            mission_juridique: !!b.mission_juridique,
            mission_fiscal: !!b.mission_fiscal,
            honoraires_ht: b.honoraires_ht || null,
            statut: 'pending_invitation',
            created_by: req.admin.id
        };

        const { data: client, error: insertErr } = await supabase
            .from('clients')
            .insert(row)
            .select()
            .single();

        if (insertErr) return res.status(500).json({ error: 'db_error', details: insertErr.message });

        // Si lead_id fourni, marquer le lead comme activé
        if (b.lead_id) {
            await supabase.from('leads').update({
                statut: 'activated',
                activated_at: new Date().toISOString()
            }).eq('id', b.lead_id);
        }

        // Envoi de l'invitation si demandé (par défaut oui)
        if (b.send_invitation !== false) {
            // Vérifie si un user existe déjà avec cet email (multi-sociétés)
            const existing = await findUserByEmail(email);

            if (existing) {
                // User existant → on crée juste le membership, pas d'invitation email
                await supabase.from('client_members').upsert({
                    client_id: client.id,
                    auth_user_id: existing.id,
                    role: 'owner',
                    accepted_at: new Date().toISOString(),
                    invited_by: req.admin.id
                }, { onConflict: 'client_id,auth_user_id' });
                await supabase.from('clients').update({
                    auth_user_id: existing.id,
                    statut: 'active',
                    activated_at: new Date().toISOString()
                }).eq('id', client.id);
                client.statut = 'active';
            } else {
                // Nouvel utilisateur → invitation email
                const redirectTo = (process.env.SITE_URL || 'http://localhost:8765') + '/espace-client.html?welcome=1';
                const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
                    redirectTo,
                    data: {
                        client_id: client.id,
                        raison_sociale: client.raison_sociale,
                        prenom: client.contact_prenom,
                        nom: client.contact_nom
                    }
                });
                if (inviteErr) {
                    console.warn('[invite] failed:', inviteErr.message);
                    return res.status(201).json({
                        client,
                        invited: false,
                        invite_error: inviteErr.message
                    });
                }
                await supabase.from('clients').update({
                    statut: 'invited',
                    invited_at: new Date().toISOString()
                }).eq('id', client.id);
                client.statut = 'invited';
            }
        }

        logActivity({
            actorUserId: req.admin.auth_user_id,
            actorRole: 'cabinet',
            action: 'client.created',
            targetType: 'client',
            targetId: client.id,
            details: { email, raison_sociale: client.raison_sociale }
        });

        // Masque la clé API dans la réponse
        if (client.pennylane_api_key) client.pennylane_api_key = '••••••••';
        res.status(201).json({ client, invited: b.send_invitation !== false });
    } catch (err) {
        console.error('[clients.create] error:', err);
        res.status(500).json({ error: 'unexpected', details: String(err.message || err) });
    }
});

router.patch('/api/admin/clients/:id', requireAdmin, async (req, res) => {
    const allowed = [
        'raison_sociale', 'siren', 'siret', 'forme_juridique', 'adresse', 'code_postal', 'ville',
        'code_naf', 'activite', 'contact_email', 'contact_prenom', 'contact_nom', 'contact_telephone',
        'pennylane_api_key', 'pennylane_company_id',
        'pennylane_email_suppliers', 'pennylane_email_customers',
        'chef_mission', 'date_debut_mission',
        'mission_compta', 'mission_social', 'mission_juridique', 'mission_fiscal',
        'honoraires_ht', 'statut'
    ];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    const { data, error } = await supabase
        .from('clients')
        .update(patch)
        .eq('id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'client.updated',
        targetType: 'client',
        targetId: req.params.id,
        details: Object.keys(patch)
    });
    if (data.pennylane_api_key) data.pennylane_api_key = '••••••••';
    res.json(data);
});

// Rafraîchir les infos d'un client depuis Pennylane + Sirene
// Synchronise aussi les dirigeants Sirene → table client_dirigeants
// (email/téléphone manuellement saisis sont préservés)
router.post('/api/admin/clients/:id/refresh-info', requireAdmin, async (req, res) => {
    const { data: client } = await supabase
        .from('clients').select('*').eq('id', req.params.id).single();
    if (!client) return res.status(404).json({ error: 'not_found' });

    const patch = {};
    const firmToken = await getSecret('pennylane_firm_token');

    if (client.pennylane_company_id && firmToken) {
        try {
            const r = await pl('/me', { apiKey: firmToken, companyId: client.pennylane_company_id });
            if (r.ok && r.body?.company) {
                const c = r.body.company;
                if (c.name) patch.raison_sociale = c.name;
                if (c.reg_no) patch.siren = c.reg_no;
            }
        } catch (e) {
            console.warn('[refresh] Pennylane failed:', e.message);
        }
    }

    const siren = patch.siren || client.siren;
    let sireneData = null;
    if (siren) {
        sireneData = await enrichFromSirene(siren);
        if (sireneData) {
            if (!patch.raison_sociale && sireneData.raison_sociale) patch.raison_sociale = sireneData.raison_sociale;
            if (sireneData.siret) patch.siret = sireneData.siret;
            if (sireneData.forme_juridique) patch.forme_juridique = sireneData.forme_juridique;
            if (sireneData.adresse) patch.adresse = sireneData.adresse;
            if (sireneData.code_postal) patch.code_postal = sireneData.code_postal;
            if (sireneData.ville) patch.ville = sireneData.ville;
            if (sireneData.code_naf) patch.code_naf = sireneData.code_naf;
            if (sireneData.activite) patch.activite = sireneData.activite;
        }
    }

    if (Object.keys(patch).length) {
        await supabase.from('clients').update(patch).eq('id', client.id);
    }

    // Sync des dirigeants Sirene (préserve email/tel)
    let dirigeantsCount = 0;
    if (sireneData?.dirigeants?.length) {
        for (const d of sireneData.dirigeants) {
            const prenom = (d.prenom || '').trim();
            const nom = (d.nom || '').trim();
            if (!prenom && !nom) continue;
            const { data: existing } = await supabase
                .from('client_dirigeants')
                .select('*')
                .eq('client_id', client.id)
                .eq('source', 'sirene')
                .eq('prenom', prenom)
                .eq('nom', nom)
                .maybeSingle();
            if (existing) {
                // Met à jour la qualité/date_naissance mais préserve email/tel
                await supabase.from('client_dirigeants').update({
                    qualite: d.qualite || existing.qualite,
                    date_naissance: d.date_naissance || existing.date_naissance
                }).eq('id', existing.id);
            } else {
                await supabase.from('client_dirigeants').insert({
                    client_id: client.id,
                    prenom, nom,
                    qualite: d.qualite || null,
                    date_naissance: d.date_naissance || null,
                    source: 'sirene'
                });
            }
            dirigeantsCount++;
        }
    }

    const { data: updated } = await supabase.from('clients').select('*').eq('id', client.id).single();
    if (updated?.pennylane_api_key) updated.pennylane_api_key = '••••••••';

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'client.refreshed',
        targetType: 'client',
        targetId: client.id,
        details: { fields: Object.keys(patch), dirigeants_synced: dirigeantsCount }
    });

    res.json({
        ok: true,
        client: updated,
        fields_updated: Object.keys(patch),
        dirigeants_synced: dirigeantsCount
    });
});

// ============================================================================
// DIRIGEANTS — CRUD
// ============================================================================
router.get('/api/admin/clients/:id/dirigeants', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('client_dirigeants')
        .select('*')
        .eq('client_id', req.params.id)
        .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    // Ne renvoie pas les credentials Impots en clair — juste un flag indiquant s'ils existent
    const items = (data || []).map(d => ({
        ...d,
        has_impots_credentials: !!(d.impots_numero_fiscal && d.impots_password),
        impots_numero_fiscal: undefined,
        impots_password: undefined
    }));
    res.json({ items });
});

router.post('/api/admin/clients/:id/dirigeants', requireAdmin, async (req, res) => {
    const b = req.body || {};
    if (!b.prenom && !b.nom) return res.status(400).json({ error: 'missing_name' });
    const row = {
        client_id: req.params.id,
        prenom: (b.prenom || '').trim() || null,
        nom: (b.nom || '').trim() || null,
        qualite: (b.qualite || '').trim() || null,
        email: (b.email || '').trim() || null,
        telephone: (b.telephone || '').trim() || null,
        is_principal: !!b.is_principal,
        source: 'manual',
        notes: b.notes || null
    };
    const { data, error } = await supabase.from('client_dirigeants').insert(row).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.patch('/api/admin/clients/:id/dirigeants/:dirId', requireAdmin, async (req, res) => {
    const allowed = ['prenom', 'nom', 'qualite', 'email', 'telephone', 'is_principal', 'notes',
                     'impots_numero_fiscal', 'impots_password'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    const { data, error } = await supabase
        .from('client_dirigeants')
        .update(patch)
        .eq('id', req.params.dirId)
        .eq('client_id', req.params.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    // Si credentials Impots modifiés → on log mais on ne renvoie pas les valeurs
    if ('impots_numero_fiscal' in req.body || 'impots_password' in req.body) {
        logActivity({
            actorUserId: req.admin.auth_user_id, actorRole: 'cabinet',
            action: 'dirigeant.impots_credentials_updated',
            targetType: 'dirigeant', targetId: req.params.dirId,
            details: { dirigeant: (data.prenom || '') + ' ' + (data.nom || '') }
        });
    }
    // Masque les credentials dans la réponse
    delete data.impots_password;
    delete data.impots_numero_fiscal;
    res.json(data);
});

// ============================================================================
// GET /api/admin/clients/:id/dirigeants/:dirId/impots — révélation des creds
// ----------------------------------------------------------------------------
// Renvoie le numéro fiscal + mot de passe en clair pour copy/paste rapide.
// Logué dans activity_log à chaque consultation.
// ============================================================================
router.get('/api/admin/clients/:id/dirigeants/:dirId/impots', requireAdmin, async (req, res) => {
    const { data, error } = await supabase
        .from('client_dirigeants')
        .select('id, prenom, nom, impots_numero_fiscal, impots_password')
        .eq('id', req.params.dirId)
        .eq('client_id', req.params.id)
        .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'not_found' });
    logActivity({
        actorUserId: req.admin.auth_user_id, actorRole: 'cabinet',
        action: 'dirigeant.impots_credentials_revealed',
        targetType: 'dirigeant', targetId: req.params.dirId,
        details: { dirigeant: (data.prenom || '') + ' ' + (data.nom || '') }
    });
    res.json({
        numero_fiscal: data.impots_numero_fiscal || '',
        password: data.impots_password || ''
    });
});

router.delete('/api/admin/clients/:id/dirigeants/:dirId', requireAdmin, async (req, res) => {
    const { error } = await supabase
        .from('client_dirigeants')
        .delete()
        .eq('id', req.params.dirId)
        .eq('client_id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// Envoyer ou renvoyer l'invitation (si le client n'a pas encore cliqué)
// Accepte optionnellement un email (si la fiche n'en a pas encore)
router.post('/api/admin/clients/:id/resend-invitation', requireAdmin, async (req, res) => {
    const { data: client } = await supabase
        .from('clients').select('*').eq('id', req.params.id).single();
    if (!client) return res.status(404).json({ error: 'not_found' });

    const providedEmail = (req.body?.email || '').trim().toLowerCase();
    let email = client.contact_email;
    if (providedEmail) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providedEmail)) {
            return res.status(400).json({ error: 'invalid_email' });
        }
        email = providedEmail;
        await supabase.from('clients').update({ contact_email: email }).eq('id', client.id);
    }

    if (!email) return res.status(400).json({ error: 'missing_email', message: "Aucun email défini pour ce client." });

    // Auto-réparation : si le client est marqué "active" mais que son auth_user_id pointe
    // vers un user inexistant (ex: supprimé depuis Supabase Dashboard), on remet à zéro
    // l'état pour permettre une nouvelle invitation.
    if (client.auth_user_id) {
        const { data: authUser } = await supabase.auth.admin.getUserById(client.auth_user_id);
        if (!authUser?.user) {
            await supabase.from('clients').update({
                auth_user_id: null,
                statut: 'pending_invitation',
                activated_at: null
            }).eq('id', client.id);
            await supabase.from('client_members').delete().eq('client_id', client.id);
            client.auth_user_id = null;
            client.statut = 'pending_invitation';
        }
    } else if (client.statut === 'active') {
        // active sans auth_user_id = état incohérent → reset
        await supabase.from('clients').update({
            statut: 'pending_invitation',
            activated_at: null
        }).eq('id', client.id);
        await supabase.from('client_members').delete().eq('client_id', client.id);
        client.statut = 'pending_invitation';
    }

    // Si un utilisateur existe déjà avec cet email → rattachement silencieux
    const existing = await findUserByEmail(email);
    if (existing) {
        await supabase.from('client_members').upsert({
            client_id: client.id,
            auth_user_id: existing.id,
            role: 'owner',
            accepted_at: new Date().toISOString(),
            invited_by: req.admin.id
        }, { onConflict: 'client_id,auth_user_id' });
        await supabase.from('clients').update({
            auth_user_id: existing.id,
            statut: 'active',
            activated_at: new Date().toISOString()
        }).eq('id', client.id);
        logActivity({
            actorUserId: req.admin.auth_user_id,
            actorRole: 'cabinet',
            action: 'client.linked_to_existing_user',
            targetType: 'client',
            targetId: client.id,
            details: { email, auth_user_id: existing.id }
        });
        return res.json({ ok: true, mode: 'linked', email });
    }

    // Sinon : envoi d'une invitation email
    const redirectTo = (process.env.SITE_URL || 'http://localhost:8765') + '/espace-client.html?welcome=1';
    const { error } = await supabase.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { client_id: client.id, raison_sociale: client.raison_sociale }
    });
    if (error) return res.status(500).json({ error: error.message });

    await supabase.from('clients').update({
        statut: 'invited',
        invited_at: new Date().toISOString()
    }).eq('id', client.id);

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'client.invitation_sent',
        targetType: 'client',
        targetId: client.id,
        details: { email }
    });

    res.json({ ok: true, mode: 'invited', email });
});

// ============================================================================
// MEMBERS — gestion des utilisateurs rattachés à un dossier client
// ----------------------------------------------------------------------------
// Un utilisateur peut être membre de plusieurs dossiers (multi-société).
// ============================================================================

// Liste des membres d'un dossier
router.get('/api/admin/clients/:id/members', requireAdmin, async (req, res) => {
    const { data: members } = await supabase
        .from('client_members')
        .select('auth_user_id, role, accepted_at, created_at')
        .eq('client_id', req.params.id);
    if (!members) return res.json({ items: [] });

    const items = [];
    for (const m of members) {
        let email = null, lastSignIn = null;
        try {
            const { data } = await supabase.auth.admin.getUserById(m.auth_user_id);
            email = data?.user?.email || null;
            lastSignIn = data?.user?.last_sign_in_at || null;
        } catch {}
        items.push({ ...m, email, last_sign_in_at: lastSignIn });
    }
    // Liste aussi les autres dossiers auxquels chaque user a accès
    for (const it of items) {
        const { data: other } = await supabase
            .from('client_members')
            .select('client_id, clients(raison_sociale)')
            .eq('auth_user_id', it.auth_user_id);
        it.other_clients = (other || [])
            .filter(o => o.client_id !== req.params.id)
            .map(o => ({ id: o.client_id, raison_sociale: o.clients?.raison_sociale }));
    }
    res.json({ items });
});

// Rattacher un utilisateur existant à un dossier (sans envoyer d'email)
router.post('/api/admin/clients/:id/members', requireAdmin, async (req, res) => {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' });
    }
    const { data: client } = await supabase
        .from('clients').select('id, raison_sociale').eq('id', req.params.id).maybeSingle();
    if (!client) return res.status(404).json({ error: 'client_not_found' });

    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'user_not_found', message: 'Aucun utilisateur avec cet email. Utilisez "Envoyer l\'invitation" pour en créer un.' });

    const { error } = await supabase.from('client_members').upsert({
        client_id: client.id,
        auth_user_id: user.id,
        role: 'owner',
        accepted_at: new Date().toISOString(),
        invited_by: req.admin.id
    }, { onConflict: 'client_id,auth_user_id' });
    if (error) return res.status(500).json({ error: error.message });

    // Si le dossier n'avait pas de user principal, on l'active
    await supabase.from('clients').update({
        auth_user_id: user.id,
        statut: 'active',
        activated_at: new Date().toISOString()
    }).eq('id', client.id).is('auth_user_id', null);

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'client.member_added',
        targetType: 'client',
        targetId: client.id,
        details: { email, auth_user_id: user.id }
    });
    res.json({ ok: true, auth_user_id: user.id, email });
});

// Retirer un utilisateur d'un dossier
router.delete('/api/admin/clients/:id/members/:userId', requireAdmin, async (req, res) => {
    const { id, userId } = req.params;
    const { error } = await supabase.from('client_members')
        .delete()
        .eq('client_id', id)
        .eq('auth_user_id', userId);
    if (error) return res.status(500).json({ error: error.message });

    // Si c'était l'auth_user_id principal du dossier, on le détache
    await supabase.from('clients').update({ auth_user_id: null })
        .eq('id', id).eq('auth_user_id', userId);

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'client.member_removed',
        targetType: 'client',
        targetId: id,
        details: { auth_user_id: userId }
    });
    res.json({ ok: true });
});

// ============================================================================
// STATS — KPIs cabinet
// ============================================================================
// Données agrégées pour le dashboard (tendance docs + activité récente)
router.get('/api/admin/overview-extras', requireAdmin, async (_req, res) => {
    try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString();

        // Documents déposés sur 6 mois + activité récente en parallèle
        const [docsRes, actRes, totalDocs] = await Promise.all([
            supabase.from('client_documents')
                .select('uploaded_at')
                .gte('uploaded_at', start)
                .order('uploaded_at', { ascending: true })
                .limit(5000),
            supabase.from('activity_log')
                .select('action, target_type, target_id, details, actor_role, created_at')
                .order('created_at', { ascending: false })
                .limit(10),
            supabase.from('client_documents').select('*', { count: 'exact', head: true })
        ]);

        // Grouper par mois (YYYY-MM)
        const buckets = {};
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const k = d.toISOString().slice(0, 7);
            buckets[k] = 0;
        }
        for (const d of (docsRes.data || [])) {
            const k = (d.uploaded_at || '').slice(0, 7);
            if (k in buckets) buckets[k]++;
        }
        const docsTrend = Object.entries(buckets).map(([month, count]) => ({ month, count }));

        res.json({
            docsTotal: totalDocs.count || 0,
            docsTrend,
            activity: actRes.data || []
        });
    } catch (err) {
        console.error('[overview-extras]', err);
        res.status(500).json({ error: String(err.message || err) });
    }
});

router.get('/api/admin/stats', requireAdmin, async (_req, res) => {
    const [
        leadsTotal, leadsNew, leadsContacted, leadsSigned,
        clientsTotal, clientsActive, clientsInvited, clientsPending
    ] = await Promise.all([
        supabase.from('leads').select('*', { count: 'exact', head: true }),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('statut', 'new'),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('statut', 'contacted'),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('statut', 'signed'),
        supabase.from('clients').select('*', { count: 'exact', head: true }),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('statut', 'active'),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('statut', 'invited'),
        supabase.from('clients').select('*', { count: 'exact', head: true }).eq('statut', 'pending_invitation')
    ]);

    res.json({
        leads: {
            total: leadsTotal.count || 0,
            new: leadsNew.count || 0,
            contacted: leadsContacted.count || 0,
            signed: leadsSigned.count || 0
        },
        clients: {
            total: clientsTotal.count || 0,
            active: clientsActive.count || 0,
            invited: clientsInvited.count || 0,
            pending: clientsPending.count || 0
        }
    });
});

// ============================================================================
// POST /api/admin/clients/import
// ----------------------------------------------------------------------------
// Import en masse d'un lot de clients. Accepte :
//   { items: [{ raison_sociale, pennylane_company_id?, contact_email?, ... }, ...] }
//   OR { text: "<texte brut à parser>" }  (NOM; ID  ou  NOM,ID  ou  NOM|ID par ligne)
// Pour chaque item, si company_id fourni, enrichit automatiquement depuis Pennylane.
// ============================================================================
router.post('/api/admin/clients/import', requireAdmin, async (req, res) => {
    try {
        const body = req.body || {};
        let items = Array.isArray(body.items) ? body.items : [];

        // Parser texte brut : 1 ligne par client, séparateurs ; | , ou tab
        if (!items.length && typeof body.text === 'string') {
            items = parseBulkText(body.text);
        }

        if (!items.length) return res.status(400).json({ error: 'empty_list' });

        const firmToken = await getSecret('pennylane_firm_token');
        const results = { ok: 0, skipped: 0, errors: [] };

        for (const item of items) {
            const companyId = String(item.pennylane_company_id || '').trim() || null;
            let raisonSociale = (item.raison_sociale || '').trim();
            let row = {
                raison_sociale: raisonSociale || null,
                siren: item.siren || null,
                siret: item.siret || null,
                forme_juridique: item.forme_juridique || null,
                adresse: item.adresse || null,
                code_postal: item.code_postal || null,
                ville: item.ville || null,
                code_naf: item.code_naf || null,
                activite: item.activite || null,
                contact_email: (item.contact_email || '').trim() || null,
                contact_prenom: item.contact_prenom || null,
                contact_nom: item.contact_nom || null,
                contact_telephone: item.contact_telephone || null,
                pennylane_api_key: item.pennylane_api_key || null,
                pennylane_company_id: companyId,
                chef_mission: item.chef_mission || req.admin.id,
                statut: 'pending_invitation',
                created_by: req.admin.id
            };

            // Étape 1 : enrichissement via Pennylane (raison sociale + SIREN)
            if (companyId && firmToken) {
                try {
                    const r = await pl('/me', { apiKey: firmToken, companyId });
                    if (r.ok && r.body?.company) {
                        const c = r.body.company;
                        if (!row.raison_sociale && c.name) row.raison_sociale = c.name;
                        if (!row.siren && c.reg_no) row.siren = c.reg_no;
                    }
                } catch (e) {
                    console.warn('[import] Pennylane enrich failed for', companyId, e.message);
                }
            }

            // Étape 2 : enrichissement via Sirene (adresse, NAF, forme, dirigeant...)
            if (row.siren) {
                const sireneData = await enrichFromSirene(row.siren);
                if (sireneData) {
                    if (!row.raison_sociale) row.raison_sociale = sireneData.raison_sociale;
                    if (!row.siret) row.siret = sireneData.siret;
                    if (!row.forme_juridique) row.forme_juridique = sireneData.forme_juridique;
                    if (!row.adresse) row.adresse = sireneData.adresse;
                    if (!row.code_postal) row.code_postal = sireneData.code_postal;
                    if (!row.ville) row.ville = sireneData.ville;
                    if (!row.code_naf) row.code_naf = sireneData.code_naf;
                    if (!row.activite) row.activite = sireneData.activite;
                }
            }

            // Contrôles
            if (!row.raison_sociale) {
                results.skipped++;
                results.errors.push({ item: item, reason: 'missing_raison_sociale' });
                continue;
            }
            // Email optionnel à l'import — on le complétera au moment de l'invitation
            if (!row.contact_email) {
                row.contact_email = ''; // placeholder, sera rempli plus tard
            }

            try {
                const { error } = await supabase.from('clients').insert(row);
                if (error) {
                    results.skipped++;
                    results.errors.push({ raison_sociale: row.raison_sociale, reason: error.message });
                } else {
                    results.ok++;
                }
            } catch (e) {
                results.skipped++;
                results.errors.push({ raison_sociale: row.raison_sociale, reason: e.message });
            }
        }

        logActivity({
            actorUserId: req.admin.auth_user_id,
            actorRole: 'cabinet',
            action: 'clients.bulk_import',
            details: results
        });

        res.json(results);
    } catch (err) {
        console.error('[import]', err);
        res.status(500).json({ error: 'unexpected', details: String(err.message || err) });
    }
});

function parseBulkText(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const out = [];
    for (const line of lines) {
        // Détecte séparateur principal (ordre : ; puis | puis tab puis virgule)
        let parts;
        if (line.includes(';')) parts = line.split(';');
        else if (line.includes('|')) parts = line.split('|');
        else if (line.includes('\t')) parts = line.split('\t');
        else if (line.includes(',')) parts = line.split(',');
        else parts = [line];

        parts = parts.map(p => p.trim()).filter(Boolean);
        if (!parts.length) continue;

        // Format attendu : [raison_sociale, company_id, email?]
        const item = { raison_sociale: parts[0] };
        for (let i = 1; i < parts.length; i++) {
            const p = parts[i];
            if (/^\d{5,}$/.test(p)) {
                item.pennylane_company_id = p;
            } else if (/@/.test(p)) {
                item.contact_email = p;
            }
        }
        out.push(item);
    }
    return out;
}

// ============================================================================
// Re-synchronisation manuelle d'un document vers Pennylane (admin)
// ============================================================================
// ============================================================================
// POST /api/admin/clients/:clientId/documents
// ----------------------------------------------------------------------------
// Permet à l'admin (cabinet) de déposer un document pour un client donné.
// Le doc apparaît automatiquement dans l'espace client de la personne concernée
// (filtré par client_id, comme tout le reste).
// ============================================================================
router.post('/api/admin/clients/:clientId/documents', requireAdmin, adminDocUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'no_file' });
        const clientId = req.params.clientId;
        const { data: client } = await supabase
            .from('clients').select('id').eq('id', clientId).maybeSingle();
        if (!client) return res.status(404).json({ error: 'client_not_found' });

        const docId = crypto.randomUUID();
        const ext = path.extname(req.file.originalname) || '';
        const storagePath = `${clientId}/${docId}${ext}`;

        const { error: upErr } = await supabase.storage
            .from('client-docs')
            .upload(storagePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });
        if (upErr) return res.status(500).json({ error: 'storage_upload_failed', details: upErr.message });

        const row = {
            id: docId,
            client_id: clientId,
            name: req.file.originalname,
            category: req.body.category || 'autre',
            permanent_key: req.body.permanent_key || null,
            period: req.body.period || null,
            note: req.body.note || null,
            size_bytes: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: req.admin.auth_user_id,
            uploaded_by_role: 'cabinet',
            pennylane_status: 'not_applicable'
        };
        const { data, error } = await supabase
            .from('client_documents')
            .insert(row)
            .select()
            .single();
        if (error) {
            await supabase.storage.from('client-docs').remove([storagePath]);
            return res.status(500).json({ error: 'db_insert_failed', details: error.message });
        }

        logActivity({
            actorUserId: req.admin.auth_user_id, actorRole: 'cabinet',
            action: 'document.uploaded_by_cabinet',
            targetType: 'document', targetId: docId,
            details: { name: req.file.originalname, client_id: clientId, category: row.category, permanent_key: row.permanent_key }
        });

        res.status(201).json(data);
    } catch (err) {
        console.error('[admin/upload-doc]', err);
        res.status(500).json({ error: 'unexpected', details: String(err.message || err) });
    }
});

router.post('/api/admin/documents/:id/sync-pennylane', requireAdmin, async (req, res) => {
    const { data: doc } = await supabase
        .from('client_documents').select('id, client_id, category').eq('id', req.params.id).single();
    if (!doc) return res.status(404).json({ error: 'not_found' });

    if (!shouldSyncToPennylane(doc.category)) {
        return res.status(400).json({ error: 'category_not_syncable', category: doc.category });
    }

    // Marque en pending + déclenche en arrière-plan
    await supabase.from('client_documents').update({
        pennylane_status: 'pending',
        pennylane_error: null
    }).eq('id', doc.id);

    syncDocBackground({ docId: doc.id, category: doc.category, clientId: doc.client_id })
        .catch(err => console.warn('[pl-sync] admin trigger error:', err));

    logActivity({
        actorUserId: req.admin.auth_user_id,
        actorRole: 'cabinet',
        action: 'document.sync_pennylane_triggered',
        targetType: 'document',
        targetId: doc.id
    });

    res.json({ ok: true, message: 'Sync lancée en arrière-plan' });
});

// ============================================================================
// DOCUMENTS — vue admin (tous les docs de tous les clients)
// ============================================================================
router.get('/api/admin/documents', requireAdmin, async (req, res) => {
    const clientId = req.query.client_id;
    const category = req.query.category;
    let q = supabase.from('client_documents')
        .select('*, clients(raison_sociale, contact_email)')
        .order('uploaded_at', { ascending: false });
    if (clientId) q = q.eq('client_id', clientId);
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
});

// ============================================================================
// PARAMÈTRES & CONNEXIONS — gestion des secrets (Pennylane, SMTP, Pappers…)
// ----------------------------------------------------------------------------
// Les valeurs réelles ne sont JAMAIS renvoyées au frontend : seulement last4.
// ============================================================================
router.get('/api/admin/secrets', requireAdmin, async (_req, res) => {
    try {
        const items = await listSecretsMasked();
        res.json({ items });
    } catch (err) {
        console.error('[secrets/list]', err);
        res.status(500).json({ error: 'list_failed', details: String(err.message || err) });
    }
});

router.post('/api/admin/secrets/:key', requireAdmin, async (req, res) => {
    const { key } = req.params;
    const { value } = req.body || {};
    if (!SECRET_DEFS[key]) return res.status(400).json({ error: 'unknown_key' });
    if (value == null) return res.status(400).json({ error: 'missing_value' });

    try {
        const result = await setSecret(key, value, { updatedBy: req.admin.auth_user_id });
        // Purge les caches Pennylane pour que la nouvelle clé prenne effet immédiatement
        // côté espace client (sinon l'ancienne réponse cachée peut être servie jusqu'à 2 min)
        if (key.startsWith('pennylane_')) {
            purgePennylaneCaches();
        }
        logActivity({
            actorUserId: req.admin.auth_user_id,
            actorRole: 'cabinet',
            action: 'secrets.update',
            targetType: 'secret',
            targetId: key,
            details: { last4: result.last4, deleted: result.deleted || false }
        });
        res.json(result);
    } catch (err) {
        console.error('[secrets/set]', err);
        res.status(500).json({ error: 'set_failed', details: String(err.message || err) });
    }
});

// Teste la connexion à un service (ne renvoie jamais la valeur du secret)
router.post('/api/admin/secrets/test/:service', requireAdmin, async (req, res) => {
    const { service } = req.params;
    try {
        if (service === 'pennylane') {
            const token = await getSecret('pennylane_firm_token');
            const companyId = await getSecret('pennylane_company_id');
            if (!token) return res.json({ ok: false, error: 'no_token' });
            const r = await pl('/me', { apiKey: token, companyId });
            return res.json({
                ok: r.ok,
                status: r.status,
                detail: r.ok ? 'Connecté — token valide' : (r.body?.error || r.body?.message || `HTTP ${r.status}`)
            });
        }
        if (service === 'smtp') {
            const from = await getSecret('smtp_from');
            const to = req.admin?.email || from;
            if (!to) return res.json({ ok: false, error: 'no_recipient' });
            const r = await sendMailWithAttachment({
                to,
                subject: '[CEDRUS] Test de connexion SMTP',
                text: 'Ceci est un email de test envoyé depuis l\'admin CEDRUS pour vérifier la configuration SMTP.\n\nSi tu reçois ce message, la configuration est fonctionnelle.',
                attachments: []
            });
            return res.json({
                ok: r.ok,
                detail: r.ok ? `Email envoyé à ${to} (messageId: ${r.messageId})` : r.error
            });
        }
        if (service === 'pappers') {
            const key = await getSecret('pappers_api_key');
            if (!key) return res.json({ ok: false, error: 'no_key' });
            const url = `https://api.pappers.fr/v2/entreprise?siren=552032534&api_token=${encodeURIComponent(key)}`;
            const r = await fetch(url);
            return res.json({
                ok: r.ok,
                status: r.status,
                detail: r.ok ? 'Clé Pappers valide' : `HTTP ${r.status}`
            });
        }
        return res.status(400).json({ error: 'unknown_service' });
    } catch (err) {
        console.error('[secrets/test]', err);
        res.status(500).json({ error: 'test_failed', details: String(err.message || err) });
    }
});

// ============================================================================
// IMPORT DEPUIS PENNYLANE FIRM API — preview + confirm
// ----------------------------------------------------------------------------
// Liste les sociétés accessibles via le firm token et compare avec la base.
// L'admin coche celles à importer, on insère + enrichit depuis Sirene.
// ============================================================================
router.get('/api/admin/clients/import-from-pennylane/preview', requireAdmin, async (_req, res) => {
    try {
        const token = await getSecret('pennylane_firm_token');
        if (!token) return res.status(400).json({ error: 'no_firm_token' });

        // Pagination 50 max → 500 dossiers
        const all = [];
        for (let page = 1; page <= 10; page++) {
            const r = await fetch('https://app.pennylane.com/api/external/firm/v1/companies?page=' + page + '&per_page=50', {
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
            });
            if (!r.ok) {
                if (r.status === 429) { await new Promise(ok => setTimeout(ok, 1500)); page--; continue; }
                return res.status(500).json({ error: 'pennylane_failed', status: r.status });
            }
            const body = await r.json();
            all.push(...(body.items || []));
            if (body.current_page >= body.total_pages) break;
            await new Promise(ok => setTimeout(ok, 400));
        }

        const { data: existing } = await supabase
            .from('clients').select('id, pennylane_company_id, raison_sociale');
        const existingIds = new Set((existing || []).map(c => c.pennylane_company_id).filter(Boolean));

        const items = all.map(c => ({
            id: c.id,
            name: c.name,
            siren: c.siren || null,
            activity_code: c.activity_code || null,
            address: c.address || null,
            postal_code: c.postal_code || null,
            city: c.city || null,
            already_imported: existingIds.has(String(c.id))
        }));

        res.json({
            total: all.length,
            already: items.filter(i => i.already_imported).length,
            new: items.filter(i => !i.already_imported).length,
            items
        });
    } catch (err) {
        console.error('[import-pennylane/preview]', err);
        res.status(500).json({ error: 'preview_failed', details: String(err.message || err) });
    }
});

router.post('/api/admin/clients/import-from-pennylane', requireAdmin, async (req, res) => {
    try {
        const ids = Array.isArray(req.body?.pennylane_ids) ? req.body.pennylane_ids.map(String) : [];
        if (!ids.length) return res.status(400).json({ error: 'no_ids_selected' });

        const token = await getSecret('pennylane_firm_token');
        if (!token) return res.status(400).json({ error: 'no_firm_token' });

        // Re-fetch la liste à jour (évite race condition)
        const all = [];
        for (let page = 1; page <= 10; page++) {
            const r = await fetch('https://app.pennylane.com/api/external/firm/v1/companies?page=' + page + '&per_page=50', {
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
            });
            if (!r.ok) break;
            const body = await r.json();
            all.push(...(body.items || []));
            if (body.current_page >= body.total_pages) break;
            await new Promise(ok => setTimeout(ok, 400));
        }
        const byId = new Map(all.map(c => [String(c.id), c]));

        const { data: existing } = await supabase.from('clients').select('id, pennylane_company_id');
        const existingIds = new Set((existing || []).map(c => c.pennylane_company_id).filter(Boolean));

        const toCreate = ids
            .filter(id => byId.has(id) && !existingIds.has(id))
            .map(id => {
                const c = byId.get(id);
                return {
                    raison_sociale: c.name,
                    pennylane_company_id: String(c.id),
                    siren: c.siren || null,
                    code_naf: c.activity_code || null,
                    adresse: c.address || null,
                    code_postal: c.postal_code || null,
                    ville: c.city || null,
                    mission_compta: true,
                    statut: 'pending_invitation'
                };
            });

        if (!toCreate.length) return res.json({ created: 0, enriched: 0, dirigeants: 0 });

        const { data: inserted, error: insErr } = await supabase
            .from('clients').insert(toCreate).select('id, raison_sociale, siren');
        if (insErr) return res.status(500).json({ error: 'insert_failed', details: insErr.message });

        // Enrichissement Sirene en arrière-plan (timeout court — on rend la main vite)
        let enriched = 0, dirigeantsAdded = 0;
        const sleep = ms => new Promise(ok => setTimeout(ok, ms));
        for (const c of inserted) {
            if (!c.siren) continue;
            await sleep(250);
            try {
                const s = await enrichFromSirene(c.siren);
                if (!s) continue;
                const patch = {};
                if (s.siret) patch.siret = s.siret;
                if (s.forme_juridique) patch.forme_juridique = s.forme_juridique;
                if (s.activite) patch.activite = s.activite;
                if (Object.keys(patch).length) await supabase.from('clients').update(patch).eq('id', c.id);
                enriched++;
                if (s.dirigeants?.length) {
                    for (const d of s.dirigeants) {
                        const prenom = (d.prenom || '').trim();
                        const nom = (d.nom || '').trim();
                        if (!prenom && !nom) continue;
                        await supabase.from('client_dirigeants').insert({
                            client_id: c.id, source: 'sirene',
                            prenom, nom, qualite: d.qualite || null, date_naissance: d.date_naissance || null
                        });
                        dirigeantsAdded++;
                    }
                }
            } catch {}
        }

        logActivity({
            actorUserId: req.admin.auth_user_id,
            actorRole: 'cabinet',
            action: 'clients.imported_from_pennylane',
            details: { count: inserted.length, enriched, dirigeants: dirigeantsAdded }
        });

        res.json({ created: inserted.length, enriched, dirigeants: dirigeantsAdded });
    } catch (err) {
        console.error('[import-pennylane]', err);
        res.status(500).json({ error: 'import_failed', details: String(err.message || err) });
    }
});

// ============================================================================
// RESET PASSWORD CLIENT — 2 modes : envoi mail OU mot de passe temporaire
// ============================================================================
router.post('/api/admin/clients/:id/reset-password', requireAdmin, async (req, res) => {
    try {
        const { data: client } = await supabase
            .from('clients').select('id, raison_sociale, contact_email, auth_user_id')
            .eq('id', req.params.id).maybeSingle();
        if (!client) return res.status(404).json({ error: 'client_not_found' });
        if (!client.auth_user_id) return res.status(400).json({ error: 'no_user_linked' });

        const mode = req.body?.mode === 'temp_password' ? 'temp_password' : 'email_link';

        if (mode === 'email_link') {
            // Génère un lien de récupération signé Supabase + envoi email Resend
            const { data, error } = await supabase.auth.admin.generateLink({
                type: 'recovery',
                email: client.contact_email
            });
            if (error) return res.status(500).json({ error: 'generate_link_failed', details: error.message });
            const recoveryUrl = data?.properties?.action_link;
            // L'envoi est géré par Supabase si SMTP custom configuré, sinon par mail.app.supabase.io
            logActivity({
                actorUserId: req.admin.auth_user_id, actorRole: 'cabinet',
                action: 'client.password_reset_email',
                targetType: 'client', targetId: client.id,
                details: { email: client.contact_email }
            });
            return res.json({ ok: true, mode, email: client.contact_email });
        }

        // Mode "temp_password" : on génère un mdp temporaire à communiquer manuellement
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let tempPassword = '';
        for (let i = 0; i < 12; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)];

        const { error } = await supabase.auth.admin.updateUserById(client.auth_user_id, { password: tempPassword });
        if (error) return res.status(500).json({ error: 'update_password_failed', details: error.message });

        logActivity({
            actorUserId: req.admin.auth_user_id, actorRole: 'cabinet',
            action: 'client.password_reset_temp',
            targetType: 'client', targetId: client.id,
            details: { email: client.contact_email }
        });

        res.json({ ok: true, mode, email: client.contact_email, temp_password: tempPassword });
    } catch (err) {
        console.error('[reset-password]', err);
        res.status(500).json({ error: 'reset_failed', details: String(err.message || err) });
    }
});

// ============================================================================
// SUPPRESSION DÉFINITIVE D'UN CLIENT (RGPD / fin de relation)
// ----------------------------------------------------------------------------
// Supprime en cascade : documents (storage + DB), dirigeants, salariés, members.
// Le compte auth.user est conservé s'il a accès à d'autres dossiers, sinon supprimé.
// ============================================================================
router.delete('/api/admin/clients/:id', requireAdmin, async (req, res) => {
    try {
        const confirmName = (req.body?.confirm_name || '').trim();
        const { data: client } = await supabase
            .from('clients').select('*').eq('id', req.params.id).maybeSingle();
        if (!client) return res.status(404).json({ error: 'client_not_found' });

        // Sécurité : taper le nom exact pour confirmer
        if (confirmName !== client.raison_sociale) {
            return res.status(400).json({ error: 'name_mismatch', expected: client.raison_sociale });
        }

        // 1) Documents : récupérer tous les storage_path avant suppression DB
        const { data: docs } = await supabase
            .from('client_documents').select('id, storage_path').eq('client_id', client.id);
        const storagePaths = (docs || []).map(d => d.storage_path).filter(Boolean);

        // 2) Supprimer les fichiers du Storage (par batch de 100)
        let storageRemoved = 0;
        for (let i = 0; i < storagePaths.length; i += 100) {
            const batch = storagePaths.slice(i, i + 100);
            const { error } = await supabase.storage.from('client-docs').remove(batch);
            if (!error) storageRemoved += batch.length;
        }

        // 3) Supprimer les rows en cascade (l'ordre compte si pas de ON DELETE CASCADE)
        const userIds = new Set();
        const { data: members } = await supabase.from('client_members')
            .select('auth_user_id').eq('client_id', client.id);
        (members || []).forEach(m => m.auth_user_id && userIds.add(m.auth_user_id));

        await supabase.from('client_documents').delete().eq('client_id', client.id);
        await supabase.from('client_dirigeants').delete().eq('client_id', client.id);
        await supabase.from('client_salaries').delete().eq('client_id', client.id);
        await supabase.from('client_members').delete().eq('client_id', client.id);
        await supabase.from('clients').delete().eq('id', client.id);

        // 4) Pour chaque user : si plus aucun client_members, supprimer le compte auth
        let usersDeleted = 0;
        for (const uid of userIds) {
            const { count } = await supabase.from('client_members')
                .select('*', { count: 'exact', head: true })
                .eq('auth_user_id', uid);
            if ((count || 0) === 0) {
                try {
                    await supabase.auth.admin.deleteUser(uid);
                    usersDeleted++;
                } catch (e) {
                    console.warn('[delete-client] failed to delete user', uid, e.message);
                }
            }
        }

        logActivity({
            actorUserId: req.admin.auth_user_id, actorRole: 'cabinet',
            action: 'client.deleted',
            targetType: 'client', targetId: client.id,
            details: {
                raison_sociale: client.raison_sociale,
                docs_removed: docs?.length || 0,
                storage_removed: storageRemoved,
                users_deleted: usersDeleted
            }
        });

        res.json({
            ok: true,
            raison_sociale: client.raison_sociale,
            docs_removed: docs?.length || 0,
            storage_removed: storageRemoved,
            users_deleted: usersDeleted
        });
    } catch (err) {
        console.error('[delete-client]', err);
        res.status(500).json({ error: 'delete_failed', details: String(err.message || err) });
    }
});

export default router;
