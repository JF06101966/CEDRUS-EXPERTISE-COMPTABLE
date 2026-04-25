-- ============================================================================
-- Migration 002 - Registre social (dossiers salariés + documents rattachés)
-- ============================================================================

-- Table : client_salaries (1 par salarié du client)
create table if not exists public.client_salaries (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references public.clients(id) on delete cascade,
    prenom text not null,
    nom text not null,
    email text,
    telephone text,
    date_embauche date,
    date_sortie date,
    poste text,
    type_contrat text, -- 'CDI', 'CDD', 'Stage', 'Alternance', 'Intermittent', 'Autre'
    numero_ss text, -- numéro sécurité sociale (sensible)
    notes text,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    created_by uuid
);

create index if not exists client_salaries_client_id_idx on public.client_salaries(client_id);
create index if not exists client_salaries_nom_idx on public.client_salaries(nom, prenom);

-- Trigger updated_at
drop trigger if exists client_salaries_set_updated_at on public.client_salaries;
create trigger client_salaries_set_updated_at
before update on public.client_salaries
for each row execute function public.set_updated_at();

-- Ajout colonne salarie_id à client_documents (document rattaché à un salarié)
alter table public.client_documents
    add column if not exists salarie_id uuid references public.client_salaries(id) on delete set null;

create index if not exists client_documents_salarie_idx on public.client_documents(salarie_id);

-- RLS : client ne voit que ses propres salariés
alter table public.client_salaries enable row level security;

drop policy if exists "salaries_self_read" on public.client_salaries;
create policy "salaries_self_read"
on public.client_salaries for select
using (
    exists (
        select 1 from public.clients
        where clients.id = client_salaries.client_id
        and clients.auth_user_id = auth.uid()
    )
);

drop policy if exists "salaries_self_insert" on public.client_salaries;
create policy "salaries_self_insert"
on public.client_salaries for insert
with check (
    exists (
        select 1 from public.clients
        where clients.id = client_salaries.client_id
        and clients.auth_user_id = auth.uid()
    )
);

drop policy if exists "salaries_self_update" on public.client_salaries;
create policy "salaries_self_update"
on public.client_salaries for update
using (
    exists (
        select 1 from public.clients
        where clients.id = client_salaries.client_id
        and clients.auth_user_id = auth.uid()
    )
);
