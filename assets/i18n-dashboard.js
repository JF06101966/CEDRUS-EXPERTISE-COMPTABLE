// ============================================================================
// i18n dashboard CEDRUS — FR / EN
// Utilise data-i18n="clé" sur chaque élément texte du HTML.
// Pour le JS dynamique, utiliser window.t('clé').
// ============================================================================

window.I18N = {
    fr: {
        // Sidebar
        'sidebar.portal': 'Espace Client',
        'sidebar.active_dossier': 'Dossier en cours',
        'sidebar.switch': '⇄ Changer de dossier',
        'nav.dashboard': 'Tableau de bord',
        'nav.upload': 'Déposer un document',
        'nav.documents': 'Mes documents',
        'nav.shared_section': 'Documents partagés',
        'nav.permanent': 'Dossier permanent',
        'nav.fiscal': 'Déclarations fiscales',
        'nav.juridique': 'Registre juridique',
        'nav.social': 'Registre social',
        'nav.account_section': 'Compte',
        'nav.infos': 'Mes informations',
        'nav.signout': 'Se déconnecter',

        // Overview / header
        'overview.welcome_prefix': 'Bonjour',
        'overview.welcome_subtitle': 'Bienvenue dans votre espace personnel CEDRUS.',
        'overview.status_active': 'En cours',
        'overview.status_pennylane': 'Connecté à Pennylane',
        'overview.updated_ago': 'il y a {n} min',
        'overview.refresh': 'Actualiser',
        'overview.last_sync': 'Dernière synchronisation :',
        'overview.income_statement': 'Compte de résultat',
        'overview.attestation_ca': 'Attestation de CA',

        // KPIs principaux
        'kpi.ca_ht': "Chiffre d'affaires HT",
        'kpi.dispo': 'Disponibilités',
        'kpi.charges_soc': 'Charges de la société',
        'kpi.view_detail_accounts': 'Voir le détail par compte →',
        'kpi.view_detail': 'Voir le détail →',
        'kpi.view_detail_class': 'Voir le détail par classe →',
        'kpi.ca_title': "Chiffre d'affaires HT",
        'kpi.dispo_title': 'Disponibilités',

        // Recent docs
        'recent.title': 'Documents récents',
        'recent.empty': 'Aucun document pour le moment',
        'recent.upload_first': 'Déposer mon premier document',

        // Upload
        'upload.title': 'Déposer un document',
        'upload.subtitle': 'Sélectionnez la catégorie puis déposez votre fichier.',
        'upload.type_label': 'Type de document',
        'upload.dropzone': 'Cliquez ou glissez vos fichiers ici',
        'upload.formats': 'PDF, JPG, PNG, Excel, Word - Max 10 Mo',
        'upload.note_label': 'Note (facultatif)',
        'upload.note_placeholder': 'Ex : Facture fournisseur janvier 2025',
        'upload.take_photo': 'Prendre une photo',
        'upload.success': 'Document(s) déposé(s) avec succès',
        'upload.success_subtitle': 'Votre comptable y aura accès immédiatement.',

        // Categories (used in upload buttons + filter buttons)
        'cat.facture_achat': "Facture d'achat",
        'cat.facture_vente': 'Facture de vente',
        'cat.releve_bancaire': 'Relevé bancaire',
        'cat.contrat': 'Contrat',
        'cat.bulletin_paie': 'Bulletin de paie',
        'cat.fiscal': 'Document fiscal',
        'cat.juridique': 'Document juridique',
        'cat.permanent': 'Dossier permanent',
        'cat.autre': 'Autre',
        // Plural labels for filter tabs
        'cat.factures_achat': "Factures d'achat",
        'cat.factures_vente': 'Factures de vente',
        'cat.releves_bancaires': 'Relevés bancaires',
        'cat.contrats': 'Contrats',
        'cat.bulletins_paie': 'Bulletins de paie',
        'cat.documents_fiscaux': 'Documents fiscaux',
        'cat.documents_juridiques': 'Documents juridiques',
        'cat.autres': 'Autres',
        'cat.all': 'Tous',

        // Documents list
        'documents.title': 'Mes documents',
        'documents.subtitle': 'Retrouvez tous vos documents classés par catégorie.',
        'documents.search_placeholder': 'Rechercher un document...',
        'documents.empty': 'Aucun document dans cette catégorie',

        // Permanent
        'permanent.title': 'Dossier permanent',
        'permanent.subtitle': 'Les documents essentiels de votre entreprise, toujours accessibles.',
        'permanent.empty': 'Aucun document dans cette catégorie.',
        'permanent.hint_title': 'Un document manque ou doit être mis à jour ?',
        'permanent.hint_body': 'Déposez-le dans la section <button onclick="showSection(\'upload\')" class="text-cedrus-600 font-medium hover:underline">« Déposer un document »</button>, il sera classé automatiquement.',

        // Fiscal
        'fiscal.title': 'Déclarations fiscales',
        'fiscal.subtitle': 'Bilans, liasses fiscales, plaquettes comptables et attestations.',
        'fiscal.upload_btn': 'Déposer un document fiscal',
        'fiscal.tab_bilans': 'Bilans & comptes annuels',
        'fiscal.tab_liasses': 'Liasses fiscales',
        'fiscal.tab_plaquettes': 'Plaquettes comptables',
        'fiscal.tab_attestations': 'Attestations',
        'fiscal.api_note': "Les documents PDF issus de la GED Pennylane (liasses, plaquettes…) ne sont pas récupérables via API — téléchargez-les depuis Pennylane puis déposez-les ici via le bouton ci-dessus.",
        'fiscal.generate_attestation_ca': "Générer une attestation de CA",

        // Juridique
        'juridique.title': 'Registre juridique',
        'juridique.subtitle': "Procès-verbaux d'assemblées générales et récépissés de dépôt.",
        'juridique.upload_btn': 'Déposer un document juridique',
        'juridique.tab_ago': 'AGO - Ordinaires',
        'juridique.tab_age': 'AGE - Extraordinaires',
        'juridique.tab_recepisses': 'Récépissés de dépôt',
        'juridique.api_note': 'Les documents PDF issus de la GED Pennylane ne sont pas récupérables via API — téléchargez-les depuis Pennylane puis déposez-les ici via le bouton ci-dessus.',
        'juridique.empty': 'Aucun document juridique.',

        // Social (registre)
        'social.title': 'Registre social',
        'social.subtitle': "Dossiers salariés : contrats de travail, cartes d'identité, fiches de paie par année.",
        'social.add_employee': '+ Ajouter un salarié',
        'social.empty': 'Aucun salarié enregistré',
        'social.empty_hint': 'Commencez par ajouter votre premier salarié.',
        'social.stat_total': 'Salariés au total',
        'social.stat_active': 'Actuellement en poste',
        'social.stat_cdi': 'CDI',
        'social.stat_cdd': 'CDD',
        'social.sal_new': 'Nouveau salarié',
        'social.sal_edit': 'Modifier le salarié',
        'social.prenom': 'Prénom',
        'social.nom': 'Nom',
        'social.email': 'Email',
        'social.tel': 'Téléphone',
        'social.poste': 'Poste',
        'social.contrat': 'Type de contrat',
        'social.date_embauche': "Date d'embauche",
        'social.date_sortie': 'Date de sortie',
        'social.numero_ss': 'N° Sécurité sociale',
        'social.notes': 'Notes internes',
        'social.in_post': 'En poste',
        'social.left': 'Sorti',
        'social.since': 'depuis',
        'social.still_employed': 'Toujours en poste',
        'social.contract_section': '📄 Contrat de travail',
        'social.id_section': "🪪 Carte d'identité",
        'social.payslip_section': '💶 Fiches de paie',
        'social.add_contract': '+ Ajouter le contrat de travail',
        'social.add_id': "+ Ajouter la carte d'identité",
        'social.add_payslip': '+ Ajouter une fiche',
        'social.ask_year': 'Année de la fiche de paie (ex : 2025) :',
        'social.no_payslips': 'Aucune fiche de paie enregistrée.',
        'social.year': 'Année',

        // Mes informations
        'infos.title': 'Mes informations',
        'infos.subtitle': 'Retrouvez ici vos coordonnées et celles de votre société.',
        'infos.contact_title': 'Mes coordonnées',
        'infos.prenom': 'Prénom',
        'infos.nom': 'Nom',
        'infos.email': 'Email',
        'infos.tel': 'Téléphone',
        'infos.pays': 'Pays',
        'infos.entreprise_title': 'Ma société',
        'infos.ent_nom': 'Raison sociale',
        'infos.ent_siren': 'SIREN',
        'infos.ent_siret': 'SIRET',
        'infos.ent_forme': 'Forme juridique',
        'infos.ent_adresse': 'Adresse',
        'infos.ent_naf': 'Code NAF',
        'infos.ent_dirigeant': 'Dirigeant',
        'infos.ent_creation': 'Date de création',
        'infos.no_entreprise': "Aucune société rattachée à votre compte pour le moment.",

        // Attestation modal
        'att.title': "Générer une attestation de chiffre d'affaires",
        'att.subtitle': "Attestation éditée par votre cabinet pour justifier de votre CA HT.",
        'att.periode_label': 'Période',
        'att.year_mode': 'Une année entière',
        'att.dates_mode': 'Dates personnalisées',
        'att.from': 'Du',
        'att.to': 'Au',
        'att.rcs_label': "Ville du greffe d'immatriculation (RCS)",
        'att.rcs_hint': "Pré-rempli avec la ville du siège. Corrigez si le greffe diffère (ex : siège à Boulogne mais RCS Nanterre).",
        'att.ca_hint': "Le chiffre d'affaires HT est calculé automatiquement à partir des écritures Pennylane (classe 70) sur la période sélectionnée.",
        'att.cancel': 'Annuler',
        'att.generate': "Générer l'attestation",
        'att.generating': 'Génération du PDF…',
        'att.fetching_ca': 'Calcul du CA depuis Pennylane…',
        'att.ca_found': 'CA trouvé : {total} € — génération du PDF…',
        'att.ca_not_found': "Aucun CA trouvé sur cette période.",
        'att.invalid_period': 'Période invalide.',
        'att.error': 'Échec : {msg}',
        'att.pennylane_error': 'Pennylane a retourné une erreur {status}.',
        'att.missing_raison': 'Raison sociale requise.',

        // Common actions
        'actions.refresh': 'Actualiser',
        'actions.cancel': 'Annuler',
        'actions.save': 'Enregistrer',
        'actions.save_settings': 'Enregistrer les paramètres',
        'actions.edit': 'Modifier',
        'actions.delete': 'Supprimer',
        'actions.download': 'Télécharger',
        'actions.add': 'Ajouter',
        'actions.close': 'Fermer',
        'actions.saving': 'Enregistrement…',
        'actions.loading': 'Chargement…',

        // Confirm messages
        'confirm.delete_document': 'Supprimer ce document ?',
        'confirm.delete_employee': 'Supprimer définitivement {name} et ses documents ?',

        // Activity
        'activity.title': 'Historique des activités',
        'activity.empty': "Aucune activité enregistrée pour le moment",
        'activity.loading': 'Chargement…',
        'activity.soon': "Historique d'activité bientôt disponible.",
        'activity.action_generate': 'Génération',
        'activity.action_preview': 'Aperçu',
        'activity.action_download': 'Téléchargement',

        // Charts
        'chart.ca_vs_prev': 'CA mensuel (année en cours vs N-1)',
        'chart.dispo_vs_prev': 'Disponibilités mois par mois',

        // Pennylane banner
        'pennylane.banner_title': "Connexion Pennylane en cours de configuration",
        'pennylane.banner_body': "Votre dossier comptable n'est pas encore connecté à Pennylane. Les indicateurs financiers s'afficheront dès que votre expert-comptable CEDRUS aura finalisé la mise en service.",

        // Months (short)
        'month.jan': 'Jan.',
        'month.feb': 'Fév.',
        'month.mar': 'Mars',
        'month.apr': 'Avr.',
        'month.may': 'Mai',
        'month.jun': 'Juin',
        'month.jul': 'Juil.',
        'month.aug': 'Août',
        'month.sep': 'Sep.',
        'month.oct': 'Oct.',
        'month.nov': 'Nov.',
        'month.dec': 'Déc.',

        // Errors
        'error.generic': 'Erreur : {msg}',
        'error.unauthorized': 'Session expirée, veuillez vous reconnecter.',
        'error.connection': 'Erreur de connexion, réessayez.',

        // === Ajouts pour i18n complet ===
        'salarie.new': 'Nouveau salarié',
        'salarie.edit': 'Modifier le salarié',
        'nav.pending': 'Documents à traiter',
        'cat.autre_a_traiter': 'Autre document à traiter',
        'pending.title': 'Documents à traiter',
        'pending.subtitle': 'Déposez ici tout document hors factures (relevés, contrats, attestations…) — le cabinet le traitera et le classera dans votre dossier.',
        'pending.dropzone': 'Cliquez ou glissez vos fichiers ici',
        'pending.note_placeholder': 'Ex : Relevé bancaire mars 2026',
        'pending.success': 'Document déposé — il sera traité par votre expert-comptable.',
        'pending.list_title': 'Documents en attente de traitement',
        'pending.empty': 'Aucun document en attente.',
        'settings.title': 'Paramètres du compte',
        'settings.save': 'Enregistrer les paramètres',
        'activity.subtitle': 'Situations demandées et téléchargements effectués depuis votre espace.',
        'attestation.modal_title': 'Attestation de chiffre d\'affaires',
        'income.modal_title': 'Compte de résultat',
        'charges.modal_title': 'Détail des charges',
        'ca.modal_title': 'Détail du chiffre d\'affaires',
        'tx.modal_title': 'Dernières opérations bancaires'
    },

    en: {
        // Sidebar
        'sidebar.portal': 'Client Portal',
        'sidebar.active_dossier': 'Current file',
        'sidebar.switch': '⇄ Switch file',
        'nav.dashboard': 'Dashboard',
        'nav.upload': 'Upload document',
        'nav.documents': 'My documents',
        'nav.shared_section': 'Shared documents',
        'nav.permanent': 'Permanent file',
        'nav.fiscal': 'Tax filings',
        'nav.juridique': 'Legal register',
        'nav.social': 'HR register',
        'nav.account_section': 'Account',
        'nav.infos': 'My information',
        'nav.signout': 'Sign out',

        // Overview
        'overview.welcome_prefix': 'Hello',
        'overview.welcome_subtitle': 'Welcome to your personal CEDRUS space.',
        'overview.status_active': 'In progress',
        'overview.status_pennylane': 'Connected to Pennylane',
        'overview.updated_ago': '{n} min ago',
        'overview.refresh': 'Refresh',
        'overview.last_sync': 'Last sync:',
        'overview.income_statement': 'Income statement',
        'overview.attestation_ca': 'Revenue certificate',

        // KPIs
        'kpi.ca_ht': 'Revenue (excl. VAT)',
        'kpi.dispo': 'Cash on hand',
        'kpi.charges_soc': 'Company expenses',
        'kpi.view_detail_accounts': 'View breakdown by account →',
        'kpi.view_detail': 'View breakdown →',
        'kpi.view_detail_class': 'View breakdown by class →',
        'kpi.ca_title': 'Revenue (excl. VAT)',
        'kpi.dispo_title': 'Cash on hand',

        // Recent docs
        'recent.title': 'Recent documents',
        'recent.empty': 'No documents yet',
        'recent.upload_first': 'Upload my first document',

        // Upload
        'upload.title': 'Upload a document',
        'upload.subtitle': 'Select the category then upload your file.',
        'upload.type_label': 'Document type',
        'upload.dropzone': 'Click or drop your files here',
        'upload.formats': 'PDF, JPG, PNG, Excel, Word - Max 10 MB',
        'upload.note_label': 'Note (optional)',
        'upload.note_placeholder': 'E.g.: Supplier invoice January 2025',
        'upload.take_photo': 'Take a photo',
        'upload.success': 'Document(s) uploaded successfully',
        'upload.success_subtitle': 'Your accountant has immediate access.',

        // Categories
        'cat.facture_achat': 'Purchase invoice',
        'cat.facture_vente': 'Sales invoice',
        'cat.releve_bancaire': 'Bank statement',
        'cat.contrat': 'Contract',
        'cat.bulletin_paie': 'Payslip',
        'cat.fiscal': 'Tax document',
        'cat.juridique': 'Legal document',
        'cat.permanent': 'Permanent file',
        'cat.autre': 'Other',
        'cat.factures_achat': 'Purchase invoices',
        'cat.factures_vente': 'Sales invoices',
        'cat.releves_bancaires': 'Bank statements',
        'cat.contrats': 'Contracts',
        'cat.bulletins_paie': 'Payslips',
        'cat.documents_fiscaux': 'Tax documents',
        'cat.documents_juridiques': 'Legal documents',
        'cat.autres': 'Other',
        'cat.all': 'All',

        // Documents
        'documents.title': 'My documents',
        'documents.subtitle': 'Find all your documents sorted by category.',
        'documents.search_placeholder': 'Search a document...',
        'documents.empty': 'No documents in this category',

        // Permanent
        'permanent.title': 'Permanent file',
        'permanent.subtitle': 'Essential documents of your company, always accessible.',
        'permanent.empty': 'No documents in this category.',
        'permanent.hint_title': 'A document is missing or needs to be updated?',
        'permanent.hint_body': 'Drop it in the <button onclick="showSection(\'upload\')" class="text-cedrus-600 font-medium hover:underline">"Upload document"</button> section, it will be filed automatically.',

        // Fiscal
        'fiscal.title': 'Tax filings',
        'fiscal.subtitle': 'Balance sheets, tax bundles, accounting booklets and certificates.',
        'fiscal.upload_btn': 'Upload a tax document',
        'fiscal.tab_bilans': 'Balance sheets & annual accounts',
        'fiscal.tab_liasses': 'Tax bundles',
        'fiscal.tab_plaquettes': 'Accounting booklets',
        'fiscal.tab_attestations': 'Certificates',
        'fiscal.api_note': 'PDF documents from Pennylane DMS (tax bundles, booklets…) cannot be retrieved via API — download them from Pennylane and upload them here via the button above.',
        'fiscal.generate_attestation_ca': 'Generate a revenue certificate',

        // Legal
        'juridique.title': 'Legal register',
        'juridique.subtitle': 'Minutes of general meetings and filing receipts.',
        'juridique.upload_btn': 'Upload a legal document',
        'juridique.tab_ago': 'AGM - Ordinary',
        'juridique.tab_age': 'EGM - Extraordinary',
        'juridique.tab_recepisses': 'Filing receipts',
        'juridique.api_note': 'PDF documents from Pennylane DMS cannot be retrieved via API — download them from Pennylane and upload them here via the button above.',
        'juridique.empty': 'No legal documents.',

        // HR register
        'social.title': 'HR Register',
        'social.subtitle': 'Employee files: employment contracts, ID cards, payslips by year.',
        'social.add_employee': '+ Add employee',
        'social.empty': 'No employee registered yet',
        'social.empty_hint': 'Start by adding your first employee.',
        'social.stat_total': 'Total employees',
        'social.stat_active': 'Currently employed',
        'social.stat_cdi': 'Permanent',
        'social.stat_cdd': 'Fixed-term',
        'social.sal_new': 'New employee',
        'social.sal_edit': 'Edit employee',
        'social.prenom': 'First name',
        'social.nom': 'Last name',
        'social.email': 'Email',
        'social.tel': 'Phone',
        'social.poste': 'Position',
        'social.contrat': 'Contract type',
        'social.date_embauche': 'Hire date',
        'social.date_sortie': 'End date',
        'social.numero_ss': 'Social Security Number',
        'social.notes': 'Internal notes',
        'social.in_post': 'Employed',
        'social.left': 'Left',
        'social.since': 'since',
        'social.still_employed': 'Still employed',
        'social.contract_section': '📄 Employment contract',
        'social.id_section': '🪪 ID card',
        'social.payslip_section': '💶 Payslips',
        'social.add_contract': '+ Add employment contract',
        'social.add_id': '+ Add ID card',
        'social.add_payslip': '+ Add payslip',
        'social.ask_year': 'Payslip year (e.g. 2025):',
        'social.no_payslips': 'No payslip recorded.',
        'social.year': 'Year',

        // My info
        'infos.title': 'My information',
        'infos.subtitle': 'Find your personal and company details here.',
        'infos.contact_title': 'My contact details',
        'infos.prenom': 'First name',
        'infos.nom': 'Last name',
        'infos.email': 'Email',
        'infos.tel': 'Phone',
        'infos.pays': 'Country',
        'infos.entreprise_title': 'My company',
        'infos.ent_nom': 'Company name',
        'infos.ent_siren': 'SIREN',
        'infos.ent_siret': 'SIRET',
        'infos.ent_forme': 'Legal form',
        'infos.ent_adresse': 'Address',
        'infos.ent_naf': 'NAF code',
        'infos.ent_dirigeant': 'Director',
        'infos.ent_creation': 'Incorporation date',
        'infos.no_entreprise': 'No company linked to your account yet.',

        // Attestation
        'att.title': 'Generate a revenue certificate',
        'att.subtitle': 'Certificate issued by your firm to prove your revenue.',
        'att.periode_label': 'Period',
        'att.year_mode': 'A full year',
        'att.dates_mode': 'Custom dates',
        'att.from': 'From',
        'att.to': 'To',
        'att.rcs_label': 'Registry city (RCS)',
        'att.rcs_hint': "Pre-filled with the head office city. Correct if the registry differs (e.g. office in Boulogne but RCS Nanterre).",
        'att.ca_hint': 'Revenue is computed automatically from Pennylane entries (class 70) for the selected period.',
        'att.cancel': 'Cancel',
        'att.generate': 'Generate certificate',
        'att.generating': 'Generating PDF…',
        'att.fetching_ca': 'Fetching revenue from Pennylane…',
        'att.ca_found': 'Revenue found: {total} € — generating PDF…',
        'att.ca_not_found': 'No revenue found for this period.',
        'att.invalid_period': 'Invalid period.',
        'att.error': 'Failed: {msg}',
        'att.pennylane_error': 'Pennylane returned error {status}.',
        'att.missing_raison': 'Company name is required.',

        // Actions
        'actions.refresh': 'Refresh',
        'actions.cancel': 'Cancel',
        'actions.save': 'Save',
        'actions.save_settings': 'Save settings',
        'actions.edit': 'Edit',
        'actions.delete': 'Delete',
        'actions.download': 'Download',
        'actions.add': 'Add',
        'actions.close': 'Close',
        'actions.saving': 'Saving…',
        'actions.loading': 'Loading…',

        // Confirm
        'confirm.delete_document': 'Delete this document?',
        'confirm.delete_employee': 'Permanently delete {name} and their documents?',

        // Activity
        'activity.title': 'Activity history',
        'activity.empty': 'No activity recorded yet',
        'activity.loading': 'Loading…',
        'activity.soon': 'Activity history coming soon.',
        'activity.action_generate': 'Generation',
        'activity.action_preview': 'Preview',
        'activity.action_download': 'Download',

        // Charts
        'chart.ca_vs_prev': 'Monthly revenue (current year vs previous)',
        'chart.dispo_vs_prev': 'Monthly cash position',

        // Pennylane banner
        'pennylane.banner_title': 'Pennylane connection being set up',
        'pennylane.banner_body': 'Your accounting file is not yet connected to Pennylane. Financial indicators will appear as soon as your CEDRUS accountant finalizes the setup.',

        // Months
        'month.jan': 'Jan.',
        'month.feb': 'Feb.',
        'month.mar': 'Mar.',
        'month.apr': 'Apr.',
        'month.may': 'May',
        'month.jun': 'Jun.',
        'month.jul': 'Jul.',
        'month.aug': 'Aug.',
        'month.sep': 'Sep.',
        'month.oct': 'Oct.',
        'month.nov': 'Nov.',
        'month.dec': 'Dec.',

        // Errors
        'error.generic': 'Error: {msg}',
        'error.unauthorized': 'Session expired, please sign in again.',
        'error.connection': 'Connection error, please retry.',

        // === Additions for full i18n ===
        'salarie.new': 'New employee',
        'salarie.edit': 'Edit employee',
        'nav.pending': 'Documents to process',
        'cat.autre_a_traiter': 'Other document to process',
        'pending.title': 'Documents to process',
        'pending.subtitle': 'Upload here any non-invoice document (statements, contracts, certificates…) — your accountant will process and file it.',
        'pending.dropzone': 'Click or drag your files here',
        'pending.note_placeholder': 'Ex: Bank statement March 2026',
        'pending.success': 'Document uploaded — your accountant will process it.',
        'pending.list_title': 'Documents pending processing',
        'pending.empty': 'No document pending.',
        'settings.title': 'Account settings',
        'settings.save': 'Save settings',
        'activity.subtitle': 'Statements requested and downloads performed from your space.',
        'attestation.modal_title': 'Revenue certificate',
        'income.modal_title': 'Income statement',
        'charges.modal_title': 'Expense breakdown',
        'ca.modal_title': 'Revenue breakdown',
        'tx.modal_title': 'Latest bank transactions'
    }
};

window.I18N_SUPPORTED = ['fr', 'en'];

window.getI18nLang = function() {
    var s = sessionStorage.getItem('cedrus_lang_chosen') || localStorage.getItem('cedrus_lang_chosen') || 'fr';
    return window.I18N_SUPPORTED.includes(s) ? s : 'fr';
};

window.setI18nLang = function(lang) {
    if (!window.I18N_SUPPORTED.includes(lang)) return;
    sessionStorage.setItem('cedrus_lang_chosen', lang);
    localStorage.setItem('cedrus_lang_chosen', lang);
    window.applyI18n(lang);
    // Émet un événement pour que le JS dynamique puisse se re-render
    document.dispatchEvent(new CustomEvent('cedrus:lang-changed', { detail: { lang: lang } }));
};

window.applyI18n = function(lang) {
    lang = lang || window.getI18nLang();
    var dict = window.I18N[lang] || window.I18N.fr;
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
        var val = dict[el.getAttribute('data-i18n')];
        if (val !== undefined) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
        var val = dict[el.getAttribute('data-i18n-placeholder')];
        if (val !== undefined) el.placeholder = val;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el) {
        var val = dict[el.getAttribute('data-i18n-title')];
        if (val !== undefined) el.title = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
        var val = dict[el.getAttribute('data-i18n-html')];
        if (val !== undefined) el.innerHTML = val;
    });
};

window.t = function(key, vars) {
    var dict = window.I18N[window.getI18nLang()] || window.I18N.fr;
    var val = dict[key] !== undefined ? dict[key] : key;
    if (vars && typeof vars === 'object') {
        Object.keys(vars).forEach(function(k) {
            val = val.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
        });
    }
    return val;
};
