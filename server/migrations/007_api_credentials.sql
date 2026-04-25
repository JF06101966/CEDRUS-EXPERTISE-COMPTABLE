-- ============================================================================
-- Migration 007 - Table api_credentials : stockage centralisé des clés API
-- ============================================================================
-- Permet à l'admin (JF) de gérer les secrets (Pennylane, SMTP, Pappers…) depuis
-- l'interface admin plutôt que de les mettre dans .env.
--
-- Sécurité :
--  - RLS activé, seul service_role (backend) peut lire/écrire
--  - Le frontend n'accède jamais à cette table en direct, uniquement via les
--    routes admin protégées par requireAdmin
--  - Le champ `value` est en texte clair mais isolé (pas en git, pas dans .env)
--  - Pour l'UI admin, seul `last4` (4 derniers caractères) est renvoyé côté client
-- ============================================================================

create table if not exists public.api_credentials (
    key           text primary key,              -- ex: 'pennylane_firm_token', 'smtp_pass'
    value         text not null,                 -- valeur réelle (ne jamais exposer au front)
    last4         text,                          -- 4 derniers caractères pour affichage masqué
    description   text,                          -- libellé humain optionnel
    updated_at    timestamptz not null default now(),
    updated_by    uuid                           -- auth.user.id de l'admin qui a saisi
);

alter table public.api_credentials enable row level security;

-- Aucune policy : seul service_role (qui bypass RLS) peut accéder à cette table.
-- Toute requête depuis le navigateur ou un client anon retournera 0 ligne.

comment on table  public.api_credentials is 'Clés API et secrets gérés depuis l''admin. Lecture service_role uniquement.';
comment on column public.api_credentials.value is 'Valeur en clair. NE JAMAIS exposer côté client — utiliser last4.';
