// Attestation de chiffre d'affaires — version premium épurée.
// Typographie serif (Times), très peu d'ornements, large espacement, signature en bas à droite.

import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = path.resolve(__dirname, '..', '..');
const LOGO_PATH = path.resolve(SITE_ROOT, 'cedrus.png');
const SIGNATURE_CANDIDATES = [
    path.resolve(__dirname, '..', 'assets', 'signature.png'),
    path.resolve(__dirname, '..', 'assets', 'signature.jpg'),
    path.resolve(SITE_ROOT, 'signature.png'),
    path.resolve(SITE_ROOT, 'signature.jpg'),
];

// Charte CEDRUS
const COLORS = {
    ink:      '#0B1420',
    primary:  '#3E9364',
    dark:     '#357A56',
    gold:     '#B89764', // or un peu plus sobre
    muted:    '#6B7280',
    hairline: '#D8D3C4',
};

function formatEuros(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return '';
    return Math.round(n).toLocaleString('fr-FR').replace(/\s| /g, ' ') + ' €';
}
function formatDateFr(d) {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function formatPeriode(p) {
    if (!p) return '';
    if (p.annee) return `l'exercice clos le 31 décembre ${p.annee}`;
    if (p.date_debut && p.date_fin) return `la période du ${formatDateFr(p.date_debut)} au ${formatDateFr(p.date_fin)}`;
    return '';
}
function findSignaturePath(override) {
    if (override && fs.existsSync(override)) return override;
    for (const p of SIGNATURE_CANDIDATES) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

export async function generateAttestationCA(data) {
    const {
        client = {},
        periode = {},
        montant_ca,
        ville_emission = 'Boulogne-Billancourt',
        date_emission = new Date(),
        cabinet = {},
        signature_path = null,
    } = data;

    const doc = new PDFDocument({ size: 'A4', margins: { top: 80, bottom: 10, left: 90, right: 90 } });
    const buffers = [];
    doc.on('data', b => buffers.push(b));

    const LEFT = 90;
    const RIGHT = 505;
    const W = RIGHT - LEFT; // 415
    const hasLogo = fs.existsSync(LOGO_PATH);
    const sigPath = findSignaturePath(signature_path);

    // =================================================================
    // EN-TÊTE — logo + nom cabinet à gauche, coordonnées à droite
    // =================================================================
    if (hasLogo) {
        try { doc.image(LOGO_PATH, LEFT, 60, { width: 48 }); } catch (_) {}
    }
    doc.font('Times-Bold').fontSize(13).fillColor(COLORS.primary)
       .text('CEDRUS', LEFT + 60, 66, { lineBreak: false, characterSpacing: 3 });
    doc.font('Times-Italic').fontSize(8.5).fillColor(COLORS.muted)
       .text('Expertise Comptable & Conseils', LEFT + 60, 86, { lineBreak: false });

    // Bloc coordonnées cabinet — à droite, discret
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
    const cabinetLines = [
        cabinet.adresse || '8 Avenue des Terrasses',
        `${cabinet.code_postal || '92430'} ${cabinet.ville || 'Marnes-la-Coquette'}`,
        cabinet.email || 'cabinet@cedrus-expertisecomptable.com',
        'SIREN ' + (cabinet.siren || '805 220 381'),
    ].filter(Boolean);
    let infoY = 66;
    cabinetLines.forEach(line => {
        doc.text(line, LEFT, infoY, { width: W, align: 'right', lineBreak: false, characterSpacing: 0.2 });
        infoY += 10;
    });

    // Simple filet or fin en bas d'en-tête
    doc.moveTo(LEFT, 125).lineTo(RIGHT, 125).strokeColor(COLORS.gold).lineWidth(0.4).stroke();

    // =================================================================
    // TITRE — sobre, centré
    // =================================================================
    doc.font('Times-Bold').fontSize(20).fillColor(COLORS.ink)
       .text('Attestation de chiffre d\'affaires', LEFT, 185, { width: W, align: 'center' });

    // Petit filet or court sous le titre
    const midX = (LEFT + RIGHT) / 2;
    doc.moveTo(midX - 30, 220).lineTo(midX + 30, 220).strokeColor(COLORS.gold).lineWidth(0.6).stroke();

    // =================================================================
    // CORPS
    // =================================================================
    const nomSociete = (client.raison_sociale || '').trim();
    const adrLine1 = (client.adresse || '').trim();
    const adrLine2 = [(client.code_postal || '').trim(), (client.ville || '').trim()].filter(Boolean).join(' ');
    const adresseLigne = [adrLine1, adrLine2].filter(Boolean).join(' – ');
    const rcsVille = client.rcs_ville || client.ville || '';
    const siren = String(client.siren || '').trim();
    const periodeTexte = formatPeriode(periode);
    const montantTexte = formatEuros(montant_ca);

    // Paragraphe, Times-Roman 12pt, interligne généreux, justifié
    const bodyY = 265;
    doc.font('Times-Roman').fontSize(12).fillColor(COLORS.ink);
    const p1 =
        'Je soussigné, Monsieur Jean-François LE GALL, Expert-Comptable Diplômé, ' +
        'atteste par la présente que le chiffre d\'affaires hors taxes réalisé par la société ' +
        `${nomSociete}${adresseLigne ? ', sise ' + adresseLigne : ''}` +
        `${siren ? ', immatriculée au Registre du Commerce et des Sociétés de ' + rcsVille + ' sous le numéro ' + siren : ''}` +
        `, au titre de ${periodeTexte}, s\'est élevé à la somme de :`;
    doc.text(p1, LEFT, bodyY, { width: W, align: 'justify', lineGap: 4 });

    // Montant — centré, Times-Bold, en accent primaire, sans cadre
    const yAvantMontant = doc.y + 28;
    doc.font('Times-Bold').fontSize(22).fillColor(COLORS.primary)
       .text(montantTexte, LEFT, yAvantMontant, { width: W, align: 'center' });

    // Clôture — italique, centré
    const yCloture = doc.y + 32;
    doc.font('Times-Italic').fontSize(11).fillColor(COLORS.muted)
       .text('Cette attestation est établie pour servir et faire valoir ce que de droit.',
             LEFT, yCloture, { width: W, align: 'center' });

    // =================================================================
    // LIEU / DATE + SIGNATURE — en bas à droite
    // =================================================================
    const yLieu = yCloture + 60;
    doc.font('Times-Roman').fontSize(11).fillColor(COLORS.ink)
       .text(`Fait à ${ville_emission}, le ${formatDateFr(date_emission)}.`,
             LEFT, yLieu, { width: W, align: 'right' });

    // Zone signature — alignée à droite, sans cadre visible, juste l'emplacement
    const sigColX = RIGHT - 220;
    const sigColW = 220;
    const ySign = yLieu + 28;

    // Signature (image si fournie, sinon espace vierge)
    if (sigPath) {
        try {
            doc.image(sigPath, sigColX + 30, ySign, { fit: [sigColW - 60, 60], align: 'center' });
        } catch (_) {}
    }
    // L'espace vierge reste (60px) pour signature manuscrite si pas de PNG

    // Petit filet or hairline sous la signature
    const yLigneSig = ySign + 65;
    doc.moveTo(sigColX + 30, yLigneSig).lineTo(sigColX + sigColW - 30, yLigneSig)
       .strokeColor(COLORS.gold).lineWidth(0.4).stroke();

    // Nom & titre sous le filet
    doc.font('Times-Bold').fontSize(10.5).fillColor(COLORS.primary)
       .text('Jean-François LE GALL', sigColX, yLigneSig + 8, { width: sigColW, align: 'center' });
    doc.font('Times-Italic').fontSize(9).fillColor(COLORS.ink)
       .text('Expert-Comptable Diplômé', sigColX, yLigneSig + 24, { width: sigColW, align: 'center' });

    // =================================================================
    // PIED DE PAGE — légal, très discret
    // =================================================================
    doc.moveTo(LEFT, 790).lineTo(RIGHT, 790).strokeColor(COLORS.hairline).lineWidth(0.3).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(COLORS.muted);
    doc.text(
        'CEDRUS Expertise Comptable & Conseils — Inscrit au Tableau de l\'Ordre des Experts-Comptables',
        LEFT, 797, { width: W, align: 'center', lineBreak: false, characterSpacing: 0.3 }
    );
    doc.text(
        `Document émis le ${formatDateFr(new Date())}`,
        LEFT, 808, { width: W, align: 'center', lineBreak: false, characterSpacing: 0.3 }
    );

    doc.end();
    return new Promise((resolve) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
    });
}
