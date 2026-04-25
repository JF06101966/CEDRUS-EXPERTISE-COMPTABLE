-- ============================================================================
-- Migration 006 - Emails dédiés Pennylane par dossier client
-- ============================================================================
-- Pennylane fournit pour chaque dossier 2 adresses email dédiées :
--  * xxxx@suppliers.pennylane.com   → factures d'achat
--  * xxxx@customers.pennylane.com   → factures de vente
-- Envoyer un email avec le PDF en pièce jointe → OCR + import automatique
-- ============================================================================

alter table public.clients
    add column if not exists pennylane_email_suppliers text,
    add column if not exists pennylane_email_customers text;
