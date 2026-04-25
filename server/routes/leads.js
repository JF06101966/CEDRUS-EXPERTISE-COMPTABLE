import express from 'express';
import { supabase, logActivity } from '../services/supabase.js';
import { lookupCompany } from '../services/pappers.js';

const router = express.Router();

// ============================================================================
// GET /api/lookup-company?q=SIREN_OU_SIRET — public
// ----------------------------------------------------------------------------
// Utilisé par onboarding.html. Pappers en priorité (si clé configurée),
// fallback INSEE recherche-entreprises (gratuit, sans clé).
// La clé Pappers reste côté serveur — jamais exposée au navigateur.
// ============================================================================
router.get('/api/lookup-company', async (req, res) => {
    const q = String(req.query?.q || '').replace(/\D/g, '');
    if (q.length < 9) return res.status(400).json({ error: 'invalid_siren_or_siret' });
    try {
        const company = await lookupCompany(q);
        if (!company) return res.status(404).json({ error: 'not_found' });
        // Le frontend attend { results: [...] } pour rester compatible avec recherche-entreprises
        res.json({ results: [company], source: company._source || 'unknown' });
    } catch (err) {
        console.error('[lookup-company]', err);
        res.status(500).json({ error: 'lookup_failed', details: String(err.message || err) });
    }
});

// ============================================================================
// POST /api/leads — soumission publique depuis onboarding.html
// ============================================================================
router.post('/api/leads', async (req, res) => {
    try {
        const body = req.body || {};
        const email = (body.email || '').trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'invalid_email' });
        }

        const entreprise = body.entreprise || {};

        const row = {
            email,
            prenom: (body.prenom || '').trim() || null,
            nom: (body.nom || '').trim() || null,
            telephone: (body.telephone || '').trim() || null,
            langue: (body.langue || 'fr').slice(0, 5),
            pays: body.pays || null,
            statut_entreprise: body.statut_entreprise || body.statutClient || null,
            entreprise_nom: entreprise.nom || null,
            siren: entreprise.siren || null,
            siret: entreprise.siret || null,
            forme_juridique: entreprise.forme || null,
            categorie_entreprise: entreprise.categorie || null,
            adresse: entreprise.adresse || null,
            dirigeant: entreprise.dirigeant || null,
            code_naf: entreprise.naf || null,
            date_creation: entreprise.creation || null,
            effectif: entreprise.effectif || null,
            besoins: Array.isArray(body.besoins) ? body.besoins : null,
            message: (body.message || body.projet || '').trim() || null,
            projet: (body.projet || '').trim() || null,
            raw_data: body,
            user_agent: (req.headers['user-agent'] || '').slice(0, 500)
        };

        const { data, error } = await supabase
            .from('leads')
            .insert(row)
            .select('id')
            .single();

        if (error) {
            console.error('[leads] insert failed:', error);
            return res.status(500).json({ error: 'db_error', details: error.message });
        }

        logActivity({
            actorRole: 'system',
            action: 'lead.created',
            targetType: 'lead',
            targetId: data.id,
            details: { email, source: 'onboarding' },
            ipAddress: req.ip
        });

        res.status(201).json({ ok: true, id: data.id });
    } catch (err) {
        console.error('[leads] unexpected:', err);
        res.status(500).json({ error: 'unexpected', details: String(err.message || err) });
    }
});

export default router;
