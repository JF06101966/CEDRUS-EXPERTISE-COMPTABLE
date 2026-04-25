-- ============================================================================
-- Migration 003 - Multi-sociétés (un user peut gérer plusieurs dossiers)
-- ============================================================================
-- + champs MySilae préparatoires
-- ============================================================================

-- Table de liaison : user ↔ client (avec rôle)
create table if not exists public.client_members (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    auth_user_id uuid not null references auth.users(id) on delete cascade,
    role text default 'owner', -- 'owner', 'member', 'view_only'
    invited_by uuid,
    invited_at timestamptz default now(),
    accepted_at timestamptz,
    created_at timestamptz default now(),
    unique (client_id, auth_user_id)
);

create index if not exists client_members_user_idx on public.client_members(auth_user_id);
create index if not exists client_members_client_idx on public.client_members(client_id);

-- Migration des liaisons existantes (clients.auth_user_id → client_members)
insert into public.client_members (client_id, auth_user_id, role, accepted_at)
select id, auth_user_id, 'owner', activated_at
from public.clients
where auth_user_id is not null
on conflict (client_id, auth_user_id) do nothing;

-- Champs MySilae préparatoires (sync paie)
alter table public.clients
    add column if not exists mysilae_dossier_id text,
    add column if not exists mysilae_api_key text,
    add column if not exists mysilae_last_sync_at timestamptz;

alter table public.client_salaries
    add column if not exists mysilae_salarie_id text,
    add column if not exists mysilae_last_sync_at timestamptz;

alter table public.client_documents
    add column if not exists source text default 'manual'; -- 'manual' | 'mysilae_auto' | 'pennylane_auto'

-- ============================================================================
-- RLS : adapter les policies pour utiliser client_members
-- ============================================================================

-- CLIENTS : voit les clients dont je suis membre (remplace l'ancien self_read)
drop policy if exists "clients_self_read" on public.clients;
drop policy if exists "clients_member_read" on public.clients;
create policy "clients_member_read"
on public.clients for select
using (
    exists (
        select 1 from public.client_members m
        where m.client_id = clients.id
        and m.auth_user_id = auth.uid()
    )
);

-- CLIENT_MEMBERS : un user voit ses propres lignes
alter table public.client_members enable row level security;
drop policy if exists "members_self_read" on public.client_members;
create policy "members_self_read"
on public.client_members for select
using (auth_user_id = auth.uid());

-- CLIENT_DOCUMENTS : accès via membership (plus via clients.auth_user_id)
drop policy if exists "documents_self_read" on public.client_documents;
drop policy if exists "documents_member_read" on public.client_documents;
create policy "documents_member_read"
on public.client_documents for select
using (
    exists (
        select 1 from public.client_members m
        where m.client_id = client_documents.client_id
        and m.auth_user_id = auth.uid()
    )
);

drop policy if exists "documents_self_insert" on public.client_documents;
drop policy if exists "documents_member_insert" on public.client_documents;
create policy "documents_member_insert"
on public.client_documents for insert
with check (
    exists (
        select 1 from public.client_members m
        where m.client_id = client_documents.client_id
        and m.auth_user_id = auth.uid()
        and m.role in ('owner', 'member')
    )
);

-- CLIENT_SALARIES : accès via membership
drop policy if exists "salaries_self_read" on public.client_salaries;
drop policy if exists "salaries_member_read" on public.client_salaries;
create policy "salaries_member_read"
on public.client_salaries for select
using (
    exists (
        select 1 from public.client_members m
        where m.client_id = client_salaries.client_id
        and m.auth_user_id = auth.uid()
    )
);

drop policy if exists "salaries_self_insert" on public.client_salaries;
drop policy if exists "salaries_member_insert" on public.client_salaries;
create policy "salaries_member_insert"
on public.client_salaries for insert
with check (
    exists (
        select 1 from public.client_members m
        where m.client_id = client_salaries.client_id
        and m.auth_user_id = auth.uid()
        and m.role in ('owner', 'member')
    )
);

drop policy if exists "salaries_self_update" on public.client_salaries;
drop policy if exists "salaries_member_update" on public.client_salaries;
create policy "salaries_member_update"
on public.client_salaries for update
using (
    exists (
        select 1 from public.client_members m
        where m.client_id = client_salaries.client_id
        and m.auth_user_id = auth.uid()
        and m.role in ('owner', 'member')
    )
);

-- STORAGE : accès via membership (remplace l'ancienne policy qui utilisait clients.auth_user_id)
drop policy if exists "client_docs_read_own" on storage.objects;
drop policy if exists "client_docs_read_member" on storage.objects;
create policy "client_docs_read_member"
on storage.objects for select
using (
    bucket_id = 'client-docs'
    and exists (
        select 1 from public.client_members m
        where (storage.foldername(name))[1] = m.client_id::text
        and m.auth_user_id = auth.uid()
    )
);

drop policy if exists "client_docs_insert_own" on storage.objects;
drop policy if exists "client_docs_insert_member" on storage.objects;
create policy "client_docs_insert_member"
on storage.objects for insert
with check (
    bucket_id = 'client-docs'
    and exists (
        select 1 from public.client_members m
        where (storage.foldername(name))[1] = m.client_id::text
        and m.auth_user_id = auth.uid()
        and m.role in ('owner', 'member')
    )
);
