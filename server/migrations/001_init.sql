-- ============================================================================
-- CEDRUS Site - Migration 001 - Initial schema
-- ============================================================================
-- Tables : leads, clients, client_documents, admin_users, activity_log
-- Storage bucket : client-docs (privé)
-- Row Level Security : chaque client ne voit que ses propres données
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- TABLE: leads (onboardings prise de contact)
-- ============================================================================
create table if not exists public.leads (
    id uuid primary key default gen_random_uuid(),
    -- Contact
    email text not null,
    prenom text,
    nom text,
    telephone text,
    langue text default 'fr',
    pays text,
    -- Statut entreprise (existant / createur)
    statut_entreprise text,
    -- Entreprise (si déjà existante)
    entreprise_nom text,
    siren text,
    siret text,
    forme_juridique text,
    categorie_entreprise text,
    adresse text,
    dirigeant text,
    code_naf text,
    date_creation text,
    effectif text,
    -- Besoins
    besoins text[],
    message text,
    -- Projet (si créateur)
    projet text,
    -- Gestion cabinet
    statut text default 'new', -- 'new', 'contacted', 'signed', 'activated', 'rejected'
    notes text,
    contacted_at timestamptz,
    signed_at timestamptz,
    activated_at timestamptz,
    rejected_at timestamptz,
    rejected_reason text,
    assigned_to uuid,
    -- Audit
    raw_data jsonb,
    user_agent text,
    created_at timestamptz default now()
);

create index if not exists leads_statut_idx on public.leads(statut);
create index if not exists leads_email_idx on public.leads(email);
create index if not exists leads_created_at_idx on public.leads(created_at desc);

-- ============================================================================
-- TABLE: clients (dossiers actifs - créés manuellement par le cabinet)
-- ============================================================================
create table if not exists public.clients (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid unique references auth.users(id) on delete set null,
    lead_id uuid references public.leads(id) on delete set null,
    -- Identité société
    raison_sociale text not null,
    siren text,
    siret text,
    forme_juridique text,
    adresse text,
    code_postal text,
    ville text,
    code_naf text,
    activite text,
    -- Contact
    contact_email text not null,
    contact_prenom text,
    contact_nom text,
    contact_telephone text,
    -- Pennylane (clé API + company ID spécifiques au client)
    pennylane_api_key text,
    pennylane_company_id text,
    -- Mission
    chef_mission uuid,
    date_debut_mission date,
    mission_compta boolean default false,
    mission_social boolean default false,
    mission_juridique boolean default false,
    mission_fiscal boolean default false,
    honoraires_ht numeric(10,2),
    -- Statut compte
    statut text default 'pending_invitation', -- 'pending_invitation', 'invited', 'active', 'suspended'
    invited_at timestamptz,
    activated_at timestamptz,
    suspended_at timestamptz,
    -- Audit
    created_by uuid,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists clients_statut_idx on public.clients(statut);
create index if not exists clients_auth_user_id_idx on public.clients(auth_user_id);
create index if not exists clients_contact_email_idx on public.clients(contact_email);

-- ============================================================================
-- TABLE: client_documents (docs de chaque client)
-- ============================================================================
create table if not exists public.client_documents (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    name text not null,
    category text, -- 'comptable', 'fiscal', 'social', 'juridique', 'autre'
    permanent_key text, -- 'plaquettes', 'bilans', 'ago', 'recepisses', 'kbis', 'statuts'
    period text,
    note text,
    size_bytes bigint,
    mime_type text,
    storage_path text not null, -- chemin dans le bucket 'client-docs'
    uploaded_by uuid,
    uploaded_by_role text, -- 'client' | 'cabinet'
    uploaded_at timestamptz default now()
);

create index if not exists client_documents_client_id_idx on public.client_documents(client_id);
create index if not exists client_documents_category_idx on public.client_documents(category);

-- ============================================================================
-- TABLE: admin_users (équipe cabinet)
-- ============================================================================
create table if not exists public.admin_users (
    id uuid primary key default gen_random_uuid(),
    auth_user_id uuid unique references auth.users(id) on delete cascade,
    email text not null unique,
    prenom text,
    nom text,
    role text default 'collab', -- 'admin', 'chef_mission', 'collab'
    is_active boolean default true,
    created_at timestamptz default now()
);

create index if not exists admin_users_role_idx on public.admin_users(role);

-- ============================================================================
-- TABLE: activity_log (audit)
-- ============================================================================
create table if not exists public.activity_log (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid,
    actor_role text, -- 'client' | 'cabinet' | 'system'
    action text not null,
    target_type text, -- 'lead' | 'client' | 'document' | 'admin'
    target_id uuid,
    details jsonb,
    ip_address text,
    created_at timestamptz default now()
);

create index if not exists activity_log_created_at_idx on public.activity_log(created_at desc);
create index if not exists activity_log_actor_idx on public.activity_log(actor_user_id);

-- ============================================================================
-- STORAGE: bucket client-docs (privé)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('client-docs', 'client-docs', false)
on conflict (id) do nothing;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- LEADS : uniquement service_role (backend)
alter table public.leads enable row level security;

-- CLIENTS : un client connecté voit UNIQUEMENT sa propre fiche
alter table public.clients enable row level security;

drop policy if exists "clients_self_read" on public.clients;
create policy "clients_self_read"
on public.clients for select
using (auth.uid() = auth_user_id);

-- CLIENT_DOCUMENTS : un client voit UNIQUEMENT ses propres docs
alter table public.client_documents enable row level security;

drop policy if exists "documents_self_read" on public.client_documents;
create policy "documents_self_read"
on public.client_documents for select
using (
    exists (
        select 1 from public.clients
        where clients.id = client_documents.client_id
        and clients.auth_user_id = auth.uid()
    )
);

drop policy if exists "documents_self_insert" on public.client_documents;
create policy "documents_self_insert"
on public.client_documents for insert
with check (
    exists (
        select 1 from public.clients
        where clients.id = client_documents.client_id
        and clients.auth_user_id = auth.uid()
    )
);

-- ADMIN_USERS : self-read
alter table public.admin_users enable row level security;

drop policy if exists "admin_self_read" on public.admin_users;
create policy "admin_self_read"
on public.admin_users for select
using (auth.uid() = auth_user_id);

-- ACTIVITY_LOG : uniquement service_role
alter table public.activity_log enable row level security;

-- STORAGE : client ne voit que son propre dossier (préfixe = client_id)
drop policy if exists "client_docs_read_own" on storage.objects;
create policy "client_docs_read_own"
on storage.objects for select
using (
    bucket_id = 'client-docs'
    and exists (
        select 1 from public.clients c
        where c.auth_user_id = auth.uid()
        and (storage.foldername(name))[1] = c.id::text
    )
);

drop policy if exists "client_docs_insert_own" on storage.objects;
create policy "client_docs_insert_own"
on storage.objects for insert
with check (
    bucket_id = 'client-docs'
    and exists (
        select 1 from public.clients c
        where c.auth_user_id = auth.uid()
        and (storage.foldername(name))[1] = c.id::text
    )
);

-- ============================================================================
-- TRIGGERS
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
before update on public.clients
for each row execute function public.set_updated_at();

-- ============================================================================
-- FIN MIGRATION 001
-- ============================================================================
