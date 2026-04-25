-- ============================================================================
-- Migration 005 - Synchronisation Pennylane pour les documents clients
-- ============================================================================

alter table public.client_documents
    add column if not exists pennylane_doc_id text,
    add column if not exists pennylane_status text default 'not_applicable',
    -- valeurs possibles : 'not_applicable', 'pending', 'syncing', 'synced', 'failed'
    add column if not exists pennylane_synced_at timestamptz,
    add column if not exists pennylane_error text,
    add column if not exists pennylane_endpoint text;
    -- 'supplier_invoice' | 'customer_invoice' | 'file_attachment' | null

create index if not exists client_docs_pennylane_status_idx
    on public.client_documents(pennylane_status);
