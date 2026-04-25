import { supabase, verifyUserToken } from './supabase.js';

// ============================================================================
// Middleware : requireClient (multi-sociétés)
// ----------------------------------------------------------------------------
// 1) Vérifie le JWT Supabase (header Authorization)
// 2) Résout les sociétés auxquelles ce user a accès via client_members
// 3) Prend le header X-Client-Id pour identifier la société active
//    (ou la seule société si unique, ou renvoie 'multi_societies_pick' si plusieurs)
// ============================================================================
export async function requireClient(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });

    const { user, error } = await verifyUserToken(token);
    if (error || !user) return res.status(401).json({ error: 'invalid_token' });

    // Toutes les sociétés où ce user est membre
    const { data: memberships, error: memErr } = await supabase
        .from('client_members')
        .select('client_id, role, clients(*)')
        .eq('auth_user_id', user.id);

    if (memErr) return res.status(500).json({ error: 'db_error', details: memErr.message });
    if (!memberships || memberships.length === 0) {
        return res.status(403).json({ error: 'no_client_profile' });
    }

    const pickedId = req.headers['x-client-id'];
    let membership;
    if (pickedId) {
        membership = memberships.find(m => m.client_id === pickedId);
        if (!membership) return res.status(403).json({ error: 'not_member_of_this_client' });
    } else if (memberships.length === 1) {
        membership = memberships[0];
    } else {
        // Plusieurs sociétés : le front doit appeler avec X-Client-Id
        return res.status(300).json({
            error: 'multi_societies_pick',
            societies: memberships.map(m => ({
                client_id: m.client_id,
                role: m.role,
                raison_sociale: m.clients?.raison_sociale,
                pennylane_connected: !!m.clients?.pennylane_company_id
            }))
        });
    }

    const client = membership.clients;
    if (!client) return res.status(403).json({ error: 'client_not_found' });
    if (client.statut === 'suspended') return res.status(403).json({ error: 'account_suspended' });

    req.user = user;
    req.client = client;
    req.memberRole = membership.role;
    req.accessToken = token;
    next();
}

// ============================================================================
// Middleware : requireAdmin
// ----------------------------------------------------------------------------
// Vérifie le JWT Supabase + vérifie que l'utilisateur est dans admin_users (actif)
// Attache req.admin + req.user
// ============================================================================
export async function requireAdmin(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing_token' });

    const { user, error } = await verifyUserToken(token);
    if (error || !user) return res.status(401).json({ error: 'invalid_token' });

    const { data: admin, error: dbErr } = await supabase
        .from('admin_users')
        .select('*')
        .eq('auth_user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

    if (dbErr) return res.status(500).json({ error: 'db_error', details: dbErr.message });
    if (!admin) return res.status(403).json({ error: 'not_admin' });

    req.user = user;
    req.admin = admin;
    req.accessToken = token;
    next();
}

// ============================================================================
// requireRole : restreint aux rôles listés (ex: requireRole(['admin']))
// À utiliser APRÈS requireAdmin
// ============================================================================
export function requireRole(roles) {
    return (req, res, next) => {
        if (!req.admin) return res.status(401).json({ error: 'not_authenticated' });
        if (!roles.includes(req.admin.role)) return res.status(403).json({ error: 'insufficient_role' });
        next();
    };
}
