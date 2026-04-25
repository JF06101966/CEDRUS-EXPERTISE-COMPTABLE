-- ============================================================================
-- Migration 004 - Dirigeants & associés (détectés Sirene ou ajoutés à la main)
-- ============================================================================

create table if not exists public.client_dirigeants (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    prenom text,
    nom text,
    qualite text,         -- 'Président de SAS', 'Gérant', 'Associé', ...
    date_naissance text,  -- format YYYY-MM (souvent partiel Sirene)
    email text,
    telephone text,
    is_principal boolean default false,
    source text default 'sirene',  -- 'sirene' | 'manual'
    notes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists client_dirigeants_client_idx on public.client_dirigeants(client_id);
create unique index if not exists client_dirigeants_unique_sirene
    on public.client_dirigeants(client_id, coalesce(prenom,''), coalesce(nom,''), source)
    where source = 'sirene';

-- Trigger updated_at
drop trigger if exists client_dirigeants_set_updated_at on public.client_dirigeants;
create trigger client_dirigeants_set_updated_at
before update on public.client_dirigeants
for each row execute function public.set_updated_at();

-- RLS : client voit les dirigeants des sociétés dont il est membre
alter table public.client_dirigeants enable row level security;

drop policy if exists "dirigeants_member_read" on public.client_dirigeants;
create policy "dirigeants_member_read"
on public.client_dirigeants for select
using (
    exists (
        select 1 from public.client_members m
        where m.client_id = client_dirigeants.client_id
        and m.auth_user_id = auth.uid()
    )
);
