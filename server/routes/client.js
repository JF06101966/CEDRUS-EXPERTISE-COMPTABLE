import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { supabase, supabaseAuthClient, logActivity } from '../services/supabase.js';
import { requireClient } from '../services/auth.js';
import { pl, plAll } from '../services/pennylane.js';
import { shouldSyncToPennylane, syncDocBackground } from '../services/pennylane-sync.js';

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }
});

// ============================================================================
// POST /api/client/login — proxy login via Supabase Auth
// ============================================================================
router.post('/api/client/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) return res.status(400).json({ error: 'missing_credentials' });

        const authSb = supabaseAuthClient();
        const { data, error } = await authSb.auth.signInWithPassword({
            email: String(email).trim().toLowerCase(),
            password
        });
        if (error || !data?.session) {
            return res.status(401).json({ error: 'invalid_credentials' });
        }

        const societies = await listSocietiesForUser(data.user.id);
        if (societies.length === 0) return res.status(403).json({ error: 'no_client_profile' });
        const suspended = societies.find(s => s.statut === 'suspended');
        if (suspended && societies.every(s => s.statut === 'suspended')) {
            return res.status(403).json({ error: 'account_suspended' });
        }

        logActivity({
            actorUserId: data.user.id,
            actorRole: 'client',
            action: 'client.login',
            details: { nb_societies: societies.length }
        });

        res.json({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
            societies
        });
    } catch (err) {
        console.error('[client.login]', err);
        res.status(500).json({ error: 'unexpected' });
    }
});

// Liste les sociétés du user connecté (utile pour sélecteur ou rechargement)
router.get('/api/client/my-societies', async (req, res) => {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });
    const authSb = supabaseAuthClient();
    const { data: ud, error: err } = await authSb.auth.getUser(token);
    if (err || !ud?.user) return res.status(401).json({ error: 'invalid_token' });
    const societies = await listSocietiesForUser(ud.user.id);
    res.json({ societies });
});

async function listSocietiesForUser(userId) {
    const { data, error } = await supabase
        .from('client_members')
        .select('role, clients(id, raison_sociale, contact_prenom, contact_nom, statut, pennylane_company_id, siren, siret)')
        .eq('auth_user_id', userId)
        .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data
        .filter(m => m.clients)
        .map(m => ({
            id: m.clients.id,
            raison_sociale: m.clients.raison_sociale,
            contact_prenom: m.clients.contact_prenom,
            contact_nom: m.clients.contact_nom,
            statut: m.clients.statut,
            siren: m.clients.siren,
            siret: m.clients.siret,
            pennylane_connected: !!m.clients.pennylane_company_id,
            role: m.role
        }));
}

// ============================================================================
// POST /api/client/set-password — finalise l'inscription (après magic link)
// ----------------------------------------------------------------------------
// Le client reçoit un email d'invitation → clique → arrive sur la page avec
// un JWT temporaire. Il fournit ce JWT + son nouveau mdp. Le backend valide
// et positionne le mdp via service_role, puis marque le client comme "active".
// ============================================================================
router.post('/api/client/set-password', async (req, res) => {
    try {
        const { access_token, password } = req.body || {};
        if (!access_token || !password) return res.status(400).json({ error: 'missing_params' });
        if (password.length < 8) return res.status(400).json({ error: 'password_too_short' });

        const authSb = supabaseAuthClient();
        const { data: userData, error: userErr } = await authSb.auth.getUser(access_token);
        if (userErr || !userData?.user) return res.status(401).json({ error: 'invalid_token' });
        const user = userData.user;

        const { error: updErr } = await supabase.auth.admin.updateUserById(user.id, { password });
        if (updErr) return res.status(500).json({ error: 'password_update_failed', details: updErr.message });

        // Link auth.users.id <-> clients rows (multi-sociétés)
        // Toutes les fiches clients ayant cet email ET sans auth_user_id → lier + ajouter membership
        const { data: matchingClients } = await supabase
            .from('clients')
            .select('*')
            .eq('contact_email', user.email)
            .is('auth_user_id', null);

        const linkedClients = [];
        for (const c of (matchingClients || [])) {
            await supabase.from('clients').update({
                auth_user_id: user.id,
                statut: 'active',
                activated_at: new Date().toISOString()
            }).eq('id', c.id);
            // Création du membership (owner par défaut pour l'invité direct)
            await supabase.from('client_members').upsert({
                client_id: c.id,
                auth_user_id: user.id,
                role: 'owner',
                accepted_at: new Date().toISOString()
            }, { onConflict: 'client_id,auth_user_id' });
            linkedClients.push(c);
        }
        const client = linkedClients[0] || null;

        // Nouvelle session avec le mdp qu'on vient de définir (client éphémère)
        const loginSb = supabaseAuthClient();
        const { data: sess } = await loginSb.auth.signInWithPassword({
            email: user.email,
            password
        });

        logActivity({
            actorUserId: user.id,
            actorRole: 'client',
            action: 'client.password_set',
            targetType: 'client',
            targetId: client?.id
        });

        res.json({
            access_token: sess?.session?.access_token,
            refresh_token: sess?.session?.refresh_token,
            client
        });
    } catch (err) {
        console.error('[set-password]', err);
        res.status(500).json({ error: 'unexpected' });
    }
});

// ============================================================================
// POST /api/client/change-password — change le mot de passe (user déjà connecté)
// ----------------------------------------------------------------------------
// 1) Vérifie le token Bearer pour identifier l'user
// 2) Re-vérifie l'ancien mot de passe via signInWithPassword (sécurité)
// 3) Met à jour avec le nouveau mot de passe via service_role
// ============================================================================
router.post('/api/client/change-password', requireClient, async (req, res) => {
    try {
        const { current_password, new_password } = req.body || {};
        if (!current_password || !new_password) return res.status(400).json({ error: 'missing_params' });
        if (new_password.length < 8) return res.status(400).json({ error: 'password_too_short' });
        if (new_password === current_password) return res.status(400).json({ error: 'same_password' });

        // 1) Vérifie l'ancien mot de passe
        const checkSb = supabaseAuthClient();
        const { error: checkErr } = await checkSb.auth.signInWithPassword({
            email: req.user.email,
            password: current_password
        });
        if (checkErr) return res.status(401).json({ error: 'wrong_current_password' });

        // 2) Met à jour le mot de passe
        const { error: updErr } = await supabase.auth.admin.updateUserById(req.user.id, { password: new_password });
        if (updErr) return res.status(500).json({ error: 'password_update_failed', details: updErr.message });

        logActivity({
            actorUserId: req.user.id,
            actorRole: 'client',
            action: 'client.password_changed',
            targetType: 'client',
            targetId: req.client?.id
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[change-password]', err);
        res.status(500).json({ error: 'unexpected' });
    }
});

// ============================================================================
// GET /api/client/me — infos du client connecté (masque la clé API)
// ============================================================================
router.get('/api/client/me', requireClient, (req, res) => {
    const c = { ...req.client };
    c.pennylane_api_key = c.pennylane_api_key ? '••••••••' : null;
    res.json(c);
});

// ============================================================================
// GET /api/client/pennylane-status — indique si la connexion Pennylane est OK
// ============================================================================
router.get('/api/client/pennylane-status', requireClient, async (req, res) => {
    const apiKey = req.client.pennylane_api_key;
    const companyId = req.client.pennylane_company_id;
    if (!apiKey || !companyId) {
        return res.json({ configured: false, reason: 'not_configured' });
    }
    const r = await pl('/me', { apiKey, companyId });
    if (!r.ok) return res.json({ configured: true, connected: false, error: r.body });
    res.json({ configured: true, connected: true, pennylane_company: r.body?.company });
});

// ============================================================================
// DOCUMENTS — liste / upload / download / delete
// ============================================================================
router.get('/api/client/documents', requireClient, async (req, res) => {
    const { data, error } = await supabase
        .from('client_documents')
        .select('*')
        .eq('client_id', req.client.id)
        .order('uploaded_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
});

router.post('/api/client/documents', requireClient, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'no_file' });

        const docId = crypto.randomUUID();
        const ext = path.extname(req.file.originalname) || '';
        const storagePath = `${req.client.id}/${docId}${ext}`;

        const { error: uploadErr } = await supabase.storage
            .from('client-docs')
            .upload(storagePath, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });
        if (uploadErr) return res.status(500).json({ error: 'storage_upload_failed', details: uploadErr.message });

        // Si un salarie_id est fourni, on vérifie qu'il appartient bien à ce client
        let salarieId = null;
        if (req.body.salarie_id) {
            const { data: salarie } = await supabase
                .from('client_salaries')
                .select('id')
                .eq('id', req.body.salarie_id)
                .eq('client_id', req.client.id)
                .maybeSingle();
            if (!salarie) return res.status(400).json({ error: 'invalid_salarie_id' });
            salarieId = salarie.id;
        }

        const category = req.body.category || 'autre';
        const row = {
            id: docId,
            client_id: req.client.id,
            salarie_id: salarieId,
            name: req.file.originalname,
            category,
            permanent_key: req.body.permanent_key || null,
            period: req.body.period || null,
            note: req.body.note || null,
            size_bytes: req.file.size,
            mime_type: req.file.mimetype,
            storage_path: storagePath,
            uploaded_by: req.user.id,
            uploaded_by_role: 'client',
            pennylane_status: shouldSyncToPennylane(category) ? 'pending' : 'not_applicable'
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
            actorUserId: req.user.id,
            actorRole: 'client',
            action: 'document.uploaded',
            targetType: 'document',
            targetId: docId,
            details: { name: req.file.originalname, client_id: req.client.id }
        });

        // Lance la synchronisation Pennylane en arrière-plan si applicable
        const willSyncPennylane = shouldSyncToPennylane(category);
        if (willSyncPennylane) {
            syncDocBackground({ docId, category, clientId: req.client.id })
                .catch(err => console.warn('[pl-sync] background error:', err));
        }

        res.status(201).json({ ...data, pennylane_sync_triggered: willSyncPennylane });
    } catch (err) {
        console.error('[docs.upload]', err);
        res.status(500).json({ error: 'unexpected', details: String(err.message || err) });
    }
});

router.get('/api/client/documents/:id/download', requireClient, async (req, res) => {
    const { data: doc, error } = await supabase
        .from('client_documents')
        .select('*')
        .eq('id', req.params.id)
        .eq('client_id', req.client.id)
        .single();
    if (error || !doc) return res.status(404).json({ error: 'not_found' });

    if (doc.storage_deleted_at) {
        return res.status(410).json({
            error: 'document_archived',
            message: 'Ce document a été transmis à Pennylane et archivé. Retrouvez-le dans votre dossier Pennylane.',
            archived_at: doc.storage_deleted_at,
            pennylane_doc_id: doc.pennylane_doc_id
        });
    }

    // Si ?download=1, on signe avec l'option download pour forcer le téléchargement.
    // Sinon, l'URL signée affiche le fichier inline dans le navigateur (utile pour un PDF).
    const opts = req.query.download === '1' ? { download: doc.name || true } : undefined;
    const { data: signed, error: signErr } = await supabase.storage
        .from('client-docs')
        .createSignedUrl(doc.storage_path, 60, opts);
    if (signErr) return res.status(500).json({ error: signErr.message });
    res.json({ url: signed.signedUrl, name: doc.name });
});

// ============================================================================
// REGISTRE SOCIAL — CRUD salariés
// ============================================================================
router.get('/api/client/salaries', requireClient, async (req, res) => {
    const { data, error } = await supabase
        .from('client_salaries')
        .select('*')
        .eq('client_id', req.client.id)
        .order('nom', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
});

router.get('/api/client/salaries/:id', requireClient, async (req, res) => {
    const { data, error } = await supabase
        .from('client_salaries')
        .select('*')
        .eq('id', req.params.id)
        .eq('client_id', req.client.id)
        .maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'not_found' });
    res.json(data);
});

router.post('/api/client/salaries', requireClient, async (req, res) => {
    const b = req.body || {};
    if (!b.prenom || !b.nom) return res.status(400).json({ error: 'missing_name' });

    const row = {
        client_id: req.client.id,
        prenom: b.prenom.trim(),
        nom: b.nom.trim(),
        email: (b.email || '').trim() || null,
        telephone: (b.telephone || '').trim() || null,
        date_embauche: b.date_embauche || null,
        date_sortie: b.date_sortie || null,
        poste: (b.poste || '').trim() || null,
        type_contrat: b.type_contrat || null,
        numero_ss: (b.numero_ss || '').trim() || null,
        notes: (b.notes || '').trim() || null,
        created_by: req.user.id
    };

    const { data, error } = await supabase
        .from('client_salaries')
        .insert(row)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });

    logActivity({
        actorUserId: req.user.id,
        actorRole: 'client',
        action: 'salarie.created',
        targetType: 'salarie',
        targetId: data.id,
        details: { nom: row.nom, prenom: row.prenom }
    });
    res.status(201).json(data);
});

router.patch('/api/client/salaries/:id', requireClient, async (req, res) => {
    const allowed = ['prenom', 'nom', 'email', 'telephone', 'date_embauche', 'date_sortie', 'poste', 'type_contrat', 'numero_ss', 'notes'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k] || null;
    const { data, error } = await supabase
        .from('client_salaries')
        .update(patch)
        .eq('id', req.params.id)
        .eq('client_id', req.client.id)
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.delete('/api/client/salaries/:id', requireClient, async (req, res) => {
    const { error } = await supabase
        .from('client_salaries')
        .delete()
        .eq('id', req.params.id)
        .eq('client_id', req.client.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// Documents d'un salarié
router.get('/api/client/salaries/:id/documents', requireClient, async (req, res) => {
    // Vérifie appartenance
    const { data: salarie } = await supabase
        .from('client_salaries').select('id').eq('id', req.params.id).eq('client_id', req.client.id).maybeSingle();
    if (!salarie) return res.status(404).json({ error: 'not_found' });

    const { data, error } = await supabase
        .from('client_documents')
        .select('*')
        .eq('salarie_id', req.params.id)
        .order('uploaded_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ items: data });
});

router.delete('/api/client/documents/:id', requireClient, async (req, res) => {
    const { data: doc } = await supabase
        .from('client_documents')
        .select('*')
        .eq('id', req.params.id)
        .eq('client_id', req.client.id)
        .single();
    if (!doc) return res.status(404).json({ error: 'not_found' });

    await supabase.storage.from('client-docs').remove([doc.storage_path]);
    await supabase.from('client_documents').delete().eq('id', doc.id);

    logActivity({
        actorUserId: req.user.id,
        actorRole: 'client',
        action: 'document.deleted',
        targetType: 'document',
        targetId: doc.id
    });

    res.json({ ok: true });
});

// ============================================================================
// NOTE : Les routes /api/client/pennylane/* sont servies par le proxy
// dans server/index.js qui rewrite vers /api/pennylane/* avec le contexte
// Pennylane du client connecté (plContext). Pas de duplication ici.
// ============================================================================

export default router;
