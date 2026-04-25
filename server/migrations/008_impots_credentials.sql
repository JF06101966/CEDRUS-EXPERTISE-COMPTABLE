-- ============================================================================
-- Migration 008 — Identifiants Impots.gouv par dirigeant
-- ============================================================================
-- Permet à l'admin (cabinet) de stocker les identifiants impots.gouv personnels
-- de chaque dirigeant pour accélérer les démarches fiscales (déclarations,
-- consultation comptes fiscaux, mandats).
--
-- Sécurité :
--  - RLS de client_dirigeants déjà en place : seul service_role peut lire
--  - Les valeurs ne sont jamais renvoyées au front sauf via routes admin protégées
--  - Côté UI, le mot de passe s'affiche masqué (••••) sauf "révélation" explicite
-- ============================================================================

alter table public.client_dirigeants
    add column if not exists impots_numero_fiscal text,
    add column if not exists impots_password text;

comment on column public.client_dirigeants.impots_numero_fiscal is
    'Numéro fiscal personnel du dirigeant (13 chiffres). Sensible.';
comment on column public.client_dirigeants.impots_password is
    'Mot de passe impots.gouv du dirigeant. Sensible — chiffré au repos par Supabase.';
