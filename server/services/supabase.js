import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

// -----------------------------------------------------------------------------
// Client "data" : utilisé pour toutes les opérations DB (bypass RLS en mode
// service_role). NE JAMAIS appeler .auth.signIn* dessus sous peine de lui
// faire perdre son état service_role.
// -----------------------------------------------------------------------------
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

// -----------------------------------------------------------------------------
// Factory "auth" : nouvelle instance pour chaque opération auth utilisateur
// (signInWithPassword, signUp…). Isolée pour ne pas polluer le client data.
// -----------------------------------------------------------------------------
export function supabaseAuthClient() {
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
}

// -----------------------------------------------------------------------------
// Vérifie un token JWT utilisateur — utilise une instance éphémère pour que
// getUser() ne touche pas l'état de `supabase`.
// -----------------------------------------------------------------------------
export async function verifyUserToken(accessToken) {
    if (!accessToken) return { error: 'no_token' };
    const sb = supabaseAuthClient();
    const { data, error } = await sb.auth.getUser(accessToken);
    if (error || !data?.user) return { error: error?.message || 'invalid_token' };
    return { user: data.user };
}

// Log une action dans activity_log
export async function logActivity({ actorUserId, actorRole, action, targetType, targetId, details, ipAddress }) {
    try {
        await supabase.from('activity_log').insert({
            actor_user_id: actorUserId || null,
            actor_role: actorRole || null,
            action,
            target_type: targetType || null,
            target_id: targetId || null,
            details: details || null,
            ip_address: ipAddress || null
        });
    } catch (err) {
        console.warn('[activity_log] insert failed:', err.message);
    }
}
