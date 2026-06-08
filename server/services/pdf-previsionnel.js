// Rapport prévisionnel CEDRUS — version épurée, structurée par tableaux.

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

const COLORS = {
    ink: '#0B1420',
    primary: '#3E9364',
    dark: '#357A56',
    gold: '#B89764',
    muted: '#6B7280',
    softText: '#4B5563',
    hairline: '#E5E7EB',
    rowAlt: '#FBFBFA',
    bandBg: '#F4F8F5',
};

function fmtEur(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    return Math.round(n).toLocaleString('fr-FR').replace(/\s| /g, ' ') + ' €';
}
function fmtSignedEur(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    const v = Math.round(n);
    const sign = v > 0 ? '+' : '';
    return sign + v.toLocaleString('fr-FR').replace(/\s| /g, ' ') + ' €';
}
function fmtPct(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1).replace('.', ',') + ' %';
}
function formatDateFr(d) {
    const date = (d instanceof Date) ? d : new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function findSignaturePath(override) {
    if (override && fs.existsSync(override)) return override;
    for (const p of SIGNATURE_CANDIDATES) if (fs.existsSync(p)) return p;
    return null;
}

// SIG helpers — basés sur les totaux retournés par /api/pennylane/income-statement
function getCA(t)              { return (t.ventesMarchandises || 0) + (t.productionVendue || 0); }
function getMargeCom(t)        { return (t.ventesMarchandises || 0) - (t.coutMarchandises || 0); }
function getProduction(t)      { return (t.productionVendue || 0) + (t.productionStockee || 0) + (t.productionImmobilisee || 0); }
function getAchatsConso(t)     { return (t.coutMarchandises || 0) + (t.achatsMp || 0); }
function getChargesExt(t)      { return t.autresAchatsCharges || 0; }
function getVA(t)              { return getMargeCom(t) + getProduction(t) - getAchatsConso(t) - getChargesExt(t); }
function getSubventions(t)     { return t.subventionsExpl || 0; }
function getImpotsTaxes(t)     { return t.impotsTaxes || 0; }
function getFraisPersonnel(t)  { return t.chargesPersonnel || 0; }
function getEBE(t)             { return getVA(t) + getSubventions(t) - getImpotsTaxes(t) - getFraisPersonnel(t); }
function getAutresProdGestion(t) { return t.autresProduits || 0; }
function getReprises(t)        { return t.reprises || 0; }
function getAutresChGestion(t) { return t.autresCharges || 0; }
function getDotations(t)       { return t.dotations || 0; }
function getREX(t)             { return getEBE(t) + getAutresProdGestion(t) + getReprises(t) - getAutresChGestion(t) - getDotations(t); }
function getProdFin(t)         { return t.produitsFin || 0; }
function getChFin(t)           { return t.chargesFin || 0; }
function getRFin(t)            { return getProdFin(t) - getChFin(t); }
function getProdExc(t)         { return t.produitsExc || 0; }
function getChExc(t)           { return t.chargesExc || 0; }
function getRExc(t)            { return getProdExc(t) - getChExc(t); }
function getParticipation(t)   { return t.participation || 0; }
function getImpot(t)           { return t.impot || 0; }
function getRN(t)              { return getREX(t) + getRFin(t) + getRExc(t) - getParticipation(t) - getImpot(t); }
function getCAF(t)             { return getRN(t) + getDotations(t) - getReprises(t); }

export async function generatePrevisionnelReport(payload) {
    const {
        year_current,
        year_ref,
        income_statement_prev,
        hypotheses = {},
        treso_actuelle = 0,
        loans = null,
        client = {},
        ville_emission = 'Marnes-la-Coquette',
        date_emission = new Date(),
        signature_path = null,
        cabinet = {
            nom: 'CEDRUS Expertise Comptable & Conseils',
            adresse_1: '8 avenue des Terrasses',
            cp_ville: '92430 Marnes-la-Coquette',
            siren: '422 362 307',
            email: 'Cabinet@cedrus-expertisecomptable.com',
            signataire: 'Jean-François LE GALL',
            qualite: 'Expert-comptable inscrit à l\'Ordre',
        }
    } = payload;

    const doc = new PDFDocument({ size: 'A4', margins: { top: 90, bottom: 60, left: 60, right: 60 } });
    const buffers = [];
    doc.on('data', b => buffers.push(b));

    const LEFT = 60;
    const RIGHT = 535;
    const W = RIGHT - LEFT; // 475 (plus de largeur pour les tableaux)

    const hasLogo = fs.existsSync(LOGO_PATH);
    const sigPath = findSignaturePath(signature_path);

    // ============================================================
    // EN-TÊTE — logo imposant à gauche, coordonnées à droite
    // ============================================================
    function drawHeader(pageIndex) {
        if (hasLogo) {
            try { doc.image(LOGO_PATH, LEFT, 38, { width: 120 }); } catch (_) {}
        }
        doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
        const lines = [
            cabinet.adresse_1,
            cabinet.cp_ville,
            cabinet.email,
            'SIREN ' + cabinet.siren,
        ];
        let infoY = 52;
        lines.forEach(l => {
            doc.text(l, LEFT, infoY, { width: W, align: 'right', lineBreak: false });
            infoY += 11;
        });
        doc.moveTo(LEFT, 165).lineTo(RIGHT, 165).strokeColor(COLORS.gold).lineWidth(0.4).stroke();
    }
    drawHeader(0);

    let y = 195;

    // ============================================================
    // TITRE
    // ============================================================
    doc.font('Times-Bold').fontSize(22).fillColor(COLORS.ink)
        .text('Rapport sur les comptes prévisionnels', LEFT, y, { width: W, align: 'center' });
    y = doc.y + 6;
    doc.font('Times-Italic').fontSize(10.5).fillColor(COLORS.muted)
        .text('Exercice ' + year_current + ' et projection sur 5 exercices', LEFT, y, { width: W, align: 'center' });
    y = doc.y + 18;

    // ============================================================
    // CARTOUCHE ENTREPRISE / DATE
    // ============================================================
    const cartY = y;
    const cartH = 60;
    doc.roundedRect(LEFT, cartY, W, cartH, 4).fillColor(COLORS.bandBg).fill();

    // Colonne gauche : entreprise
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted).text('ENTREPRISE', LEFT + 14, cartY + 10, { characterSpacing: 1.2 });
    doc.font('Times-Bold').fontSize(12).fillColor(COLORS.ink).text(client.raison_sociale || client.name || '—', LEFT + 14, cartY + 22);
    const subItems = [];
    if (client.siren) subItems.push('SIREN ' + client.siren);
    if (client.adresse) subItems.push(client.adresse);
    if (subItems.length) {
        doc.font('Times-Roman').fontSize(9).fillColor(COLORS.softText).text(subItems.join(' · '), LEFT + 14, cartY + 40, { width: (W / 2) - 14 });
    }

    // Colonne droite : exercices
    const rightX = LEFT + W / 2 + 14;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted).text('PÉRIODE', rightX, cartY + 10, { characterSpacing: 1.2 });
    doc.font('Times-Roman').fontSize(10).fillColor(COLORS.ink).text('Exercice en cours :', rightX, cartY + 22);
    doc.font('Times-Bold').fontSize(10).fillColor(COLORS.primary).text(String(year_current), rightX + 110, cartY + 22);
    doc.font('Times-Roman').fontSize(10).fillColor(COLORS.ink).text('Exercice de référence :', rightX, cartY + 36);
    doc.font('Times-Bold').fontSize(10).fillColor(COLORS.primary).text('N-1 = ' + String(year_ref), rightX + 110, cartY + 36);
    doc.font('Times-Italic').fontSize(8.5).fillColor(COLORS.muted).text('Édité le ' + formatDateFr(date_emission), rightX, cartY + 48);

    y = cartY + cartH + 22;

    // ============================================================
    // PARAGRAPHE INTRO COURT
    // ============================================================
    doc.font('Times-Italic').fontSize(10).fillColor(COLORS.ink);
    const intro = "À la demande de la direction, nous avons accompagné l'établissement des comptes prévisionnels ci-après. Ils sont fondés sur l'exercice " + year_ref + " et sur les hypothèses retenues par la direction (cf. tableau ci-dessous). Notre intervention respecte la norme professionnelle NP 2300 de l'Ordre des experts-comptables.";
    doc.text(intro, LEFT, y, { width: W, align: 'justify', lineGap: 2 });
    y = doc.y + 18;

    // ============================================================
    // HELPERS DE TABLEAU
    // ============================================================
    function ensureSpace(needed) {
        if (y + needed > 770) {
            doc.addPage();
            drawHeader();
            y = 195;
        }
    }
    function sectionTitle(label) {
        ensureSpace(28);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.primary)
            .text(label, LEFT, y, { characterSpacing: 1.5 });
        y = doc.y + 4;
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(COLORS.gold).lineWidth(0.4).stroke();
        y += 8;
    }
    /**
     * Dessine un tableau.
     * cols: [{ label, width, align }]  width en pixels (somme ≤ W)
     * rows: [{ cells: [string], style?: 'bold'|'muted'|'highlight'|'sub', sep?: true }]
     */
    function drawTable(cols, rows, opts = {}) {
        const rowH = opts.rowH || 18;
        const headerH = opts.headerH || 20;
        const xs = []; let acc = LEFT;
        cols.forEach(c => { xs.push(acc); acc += c.width; });

        ensureSpace(headerH + Math.min(rows.length, 4) * rowH + 4);
        // header
        doc.rect(LEFT, y, W, headerH).fillColor(COLORS.bandBg).fill();
        doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted);
        cols.forEach((c, i) => {
            doc.text(c.label, xs[i] + 6, y + 6, { width: c.width - 12, align: c.align || 'left', lineBreak: false, characterSpacing: 0.6 });
        });
        y += headerH;
        // rows
        rows.forEach((row, ri) => {
            ensureSpace(rowH + 4);
            const altBg = (ri % 2 === 1);
            if (altBg && !row.style) {
                doc.rect(LEFT, y, W, rowH).fillColor(COLORS.rowAlt).fill();
            }
            if (row.style === 'highlight') {
                doc.rect(LEFT, y, W, rowH).fillColor(COLORS.bandBg).fill();
            }

            const fontFamily = (row.style === 'bold' || row.style === 'highlight') ? 'Times-Bold' : (row.style === 'sub' ? 'Times-Italic' : 'Times-Roman');
            const fontSize = (row.style === 'highlight') ? 10 : 9.5;
            const color = (row.style === 'muted') ? COLORS.muted : (row.style === 'highlight' ? COLORS.ink : COLORS.softText);
            doc.font(fontFamily).fontSize(fontSize).fillColor(color);
            cols.forEach((c, i) => {
                const txt = row.cells[i] != null ? String(row.cells[i]) : '';
                let col = color;
                if (row.signed && i > 0) {
                    const raw = (row.raw && row.raw[i]) != null ? row.raw[i] : NaN;
                    if (!isNaN(raw) && raw < 0) col = '#B91C1C';
                    else if (!isNaN(raw) && raw > 0 && row.style === 'highlight') col = COLORS.dark;
                }
                doc.fillColor(col).text(txt, xs[i] + 6, y + 5, { width: c.width - 12, align: c.align || 'left', lineBreak: false });
            });
            y += rowH;
            // séparateur sous la ligne
            if (row.sep) {
                doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(COLORS.hairline).lineWidth(0.4).stroke();
            }
        });
        // bordure basse du tableau
        doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(COLORS.hairline).lineWidth(0.4).stroke();
        y += 14;
    }

    // ============================================================
    // 1. HYPOTHÈSES
    // ============================================================
    sectionTitle('1. HYPOTHÈSES RETENUES PAR LA DIRECTION');
    drawTable(
        [
            { label: 'Hypothèse', width: 295 },
            { label: 'Valeur', width: 180, align: 'right' },
        ],
        [
            { cells: ['Évolution annuelle du chiffre d\'affaires', fmtPct(hypotheses.pct_ca || 0)] },
            { cells: ['Évolution annuelle des frais de personnel', fmtPct(hypotheses.pct_pers || 0)] },
            { cells: ['Trésorerie de départ', fmtEur(hypotheses.treso_init || 0)] },
            { cells: ['Remboursement annuel d\'emprunts (capital)', fmtEur(hypotheses.emp_annuel || 0)] },
            { cells: ['Investissements annuels prévus', fmtEur(hypotheses.invest_annuel || 0)] },
        ]
    );
    if (loans && (loans.crd > 0 || loans.remboursementPrev > 0)) {
        doc.font('Times-Italic').fontSize(8.5).fillColor(COLORS.muted)
            .text('Source emprunts : extrait Pennylane (comptes 164/165/168). Capital restant dû : ' + fmtEur(loans.crd) + '. Remboursement constaté en ' + year_ref + ' : ' + fmtEur(loans.remboursementPrev) + '.',
                LEFT, y, { width: W, align: 'justify' });
        y = doc.y + 14;
    }

    // ============================================================
    // 2. EXERCICE DE RÉFÉRENCE — SIG N-1
    // ============================================================
    if (income_statement_prev) {
        sectionTitle('2. EXERCICE DE RÉFÉRENCE — ' + year_ref + ' · SOLDES INTERMÉDIAIRES DE GESTION');
        const t = income_statement_prev;
        const ca = getCA(t);
        const refRows = [
            { cells: ['Chiffre d\'affaires (ventes + production)', fmtEur(ca), '100,0 %'], style: 'highlight' },
            { cells: ['Achats consommés', fmtEur(-getAchatsConso(t)), pctOf(getAchatsConso(t), ca)] },
            { cells: ['Charges externes', fmtEur(-getChargesExt(t)), pctOf(getChargesExt(t), ca)] },
            { cells: ['VALEUR AJOUTÉE', fmtEur(getVA(t)), pctOf(getVA(t), ca)], style: 'highlight' },
            { cells: ['+ Subventions d\'exploitation', fmtEur(getSubventions(t)), pctOf(getSubventions(t), ca)], style: 'sub' },
            { cells: ['− Impôts & taxes', fmtEur(-getImpotsTaxes(t)), pctOf(getImpotsTaxes(t), ca)], style: 'sub' },
            { cells: ['− Frais de personnel', fmtEur(-getFraisPersonnel(t)), pctOf(getFraisPersonnel(t), ca)], style: 'sub' },
            { cells: ['EBE (Excédent Brut d\'Exploitation)', fmtEur(getEBE(t)), pctOf(getEBE(t), ca)], style: 'highlight' },
            { cells: ['+ Autres produits / reprises', fmtEur(getAutresProdGestion(t) + getReprises(t)), pctOf(getAutresProdGestion(t) + getReprises(t), ca)], style: 'sub' },
            { cells: ['− Autres charges de gestion', fmtEur(-getAutresChGestion(t)), pctOf(getAutresChGestion(t), ca)], style: 'sub' },
            { cells: ['− Dotations amort./prov. (non décaissables)', fmtEur(-getDotations(t)), pctOf(getDotations(t), ca)], style: 'sub' },
            { cells: ['RÉSULTAT D\'EXPLOITATION', fmtEur(getREX(t)), pctOf(getREX(t), ca)], style: 'highlight' },
            { cells: ['+ Résultat financier', fmtEur(getRFin(t)), pctOf(getRFin(t), ca)], style: 'sub' },
            { cells: ['+ Résultat exceptionnel', fmtEur(getRExc(t)), pctOf(getRExc(t), ca)], style: 'sub' },
            { cells: ['− Participation des salariés', fmtEur(-getParticipation(t)), pctOf(getParticipation(t), ca)], style: 'sub' },
            { cells: ['− Impôt sur les bénéfices', fmtEur(-getImpot(t)), pctOf(getImpot(t), ca)], style: 'sub' },
            { cells: ['RÉSULTAT NET', fmtEur(getRN(t)), pctOf(getRN(t), ca)], style: 'highlight', signed: true, raw: [0, getRN(t)] },
            { cells: ['CAF (= RN + dotations − reprises)', fmtEur(getCAF(t)), pctOf(getCAF(t), ca)], style: 'highlight' },
        ];
        drawTable(
            [
                { label: 'Poste SIG', width: 280 },
                { label: year_ref, width: 105, align: 'right' },
                { label: '% du CA', width: 90, align: 'right' },
            ],
            refRows,
            { rowH: 14 }
        );

        // ============================================================
        // 3. SIG PRÉVISIONNEL SUR 5 EXERCICES
        // ============================================================
        sectionTitle('3. SIG PRÉVISIONNEL · 5 EXERCICES');
        const pctCa = (hypotheses.pct_ca || 0) / 100;
        const pctPers = (hypotheses.pct_pers || 0) / 100;
        const base = {
            ventes: t.ventesMarchandises || 0,
            cout: t.coutMarchandises || 0,
            production: getProduction(t),
            achats: getAchatsConso(t),
            externes: getChargesExt(t),
            subventions: getSubventions(t),
            impotsTaxes: getImpotsTaxes(t),
            pers: getFraisPersonnel(t),
            autresProd: getAutresProdGestion(t),
            reprises: getReprises(t),
            autresCh: getAutresChGestion(t),
            dotations: getDotations(t),
            prodFin: getProdFin(t),
            chFin: getChFin(t),
            prodExc: getProdExc(t),
            chExc: getChExc(t),
            participation: getParticipation(t),
            impot: getImpot(t)
        };
        const yearsProj = [];
        const yearLabels = [];
        for (let i = 1; i <= 5; i++) {
            const fCa = Math.pow(1 + pctCa, i);
            const fPers = Math.pow(1 + pctPers, i);
            const y = {
                ca: (base.ventes + base.production) * fCa,
                margeCom: (base.ventes - base.cout) * fCa,
                achats: base.achats * fCa,
                externes: base.externes * fCa,
                subventions: base.subventions,
                impotsTaxes: base.impotsTaxes * fCa,
                pers: base.pers * fPers,
                autresProd: base.autresProd * fCa,
                reprises: base.reprises,
                autresCh: base.autresCh * fCa,
                dotations: base.dotations,
                prodFin: base.prodFin,
                chFin: base.chFin,
                prodExc: base.prodExc,
                chExc: base.chExc,
                participation: base.participation
            };
            y.va = y.margeCom + (base.production * fCa) - y.achats - y.externes;
            y.ebe = y.va + y.subventions - y.impotsTaxes - y.pers;
            y.rex = y.ebe + y.autresProd + y.reprises - y.autresCh - y.dotations;
            y.rFin = y.prodFin - y.chFin;
            y.rExc = y.prodExc - y.chExc;
            y.rnAvantImpot = y.rex + y.rFin + y.rExc - y.participation;
            y.impot = Math.max(0, y.rnAvantImpot > 42500
                ? 42500 * 0.15 + (y.rnAvantImpot - 42500) * 0.25
                : y.rnAvantImpot * 0.15);
            y.rn = y.rnAvantImpot - y.impot;
            y.caf = y.rn + y.dotations - y.reprises;
            yearsProj.push(y);
            yearLabels.push(String(year_current + i - 1));
        }

        const colLab = 195;
        const colYW = (W - colLab) / 5;
        const sigCols = [{ label: 'Poste SIG', width: colLab }]
            .concat(yearLabels.map(l => ({ label: l, width: colYW, align: 'right' })));

        function rowOf(label, key, opts) {
            const cells = [label].concat(yearsProj.map(y => fmtEur(y[key])));
            return Object.assign({ cells }, opts || {});
        }
        drawTable(sigCols, [
            rowOf("Chiffre d'affaires", 'ca', { style: 'highlight' }),
            rowOf('Achats consommés', 'achats', { style: 'sub' }),
            rowOf('Charges externes', 'externes', { style: 'sub' }),
            rowOf('VALEUR AJOUTÉE', 'va', { style: 'bold' }),
            rowOf('Subventions exploitation', 'subventions', { style: 'sub' }),
            rowOf('Impôts & taxes', 'impotsTaxes', { style: 'sub' }),
            rowOf('Frais de personnel', 'pers', { style: 'sub' }),
            rowOf('EBE', 'ebe', { style: 'highlight' }),
            rowOf('Autres produits gestion', 'autresProd', { style: 'sub' }),
            rowOf('Reprises amort./prov.', 'reprises', { style: 'sub' }),
            rowOf('Autres charges gestion', 'autresCh', { style: 'sub' }),
            rowOf('Dotations amort./prov.', 'dotations', { style: 'sub' }),
            rowOf("Résultat d'exploitation", 'rex', { style: 'bold' }),
            rowOf('Résultat financier', 'rFin', { style: 'sub' }),
            rowOf('Résultat exceptionnel', 'rExc', { style: 'sub' }),
            rowOf('Impôt sur les bénéfices', 'impot', { style: 'sub' }),
            Object.assign(rowOf('RÉSULTAT NET', 'rn', { style: 'highlight', signed: true }),
                { raw: [0].concat(yearsProj.map(y => y.rn)) }),
            rowOf('CAF (RN + dotations − reprises)', 'caf', { style: 'highlight' }),
        ], { rowH: 13 });

        // ============================================================
        // 4. BUDGET DE TRÉSORERIE (basé sur la CAF)
        // ============================================================
        sectionTitle('4. BUDGET DE TRÉSORERIE · BASÉ SUR LA CAF');
        const empA = hypotheses.emp_annuel || 0;
        const invA = hypotheses.invest_annuel || 0;
        let tresoPrec = hypotheses.treso_init || 0;
        const treso = [];
        yearsProj.forEach(y => {
            const variation = y.caf - empA - invA;
            const debut = tresoPrec;
            const fin = debut + variation;
            treso.push({ debut, caf: y.caf, emp: -empA, inv: -invA, variation, fin });
            tresoPrec = fin;
        });

        function tresoRow(label, key, opts) {
            const cells = [label].concat(treso.map(t => opts && opts.signed ? fmtSignedEur(t[key]) : fmtEur(t[key])));
            const raw = [0].concat(treso.map(t => t[key]));
            return Object.assign({ cells, raw, signed: !!(opts && opts.signed) }, opts || {});
        }
        drawTable(sigCols, [
            tresoRow('Trésorerie au 1er janvier', 'debut'),
            tresoRow('+ CAF (cash-flow exploitation)', 'caf', { signed: true, style: 'bold' }),
            tresoRow("− Remboursement d'emprunts", 'emp', { signed: true }),
            tresoRow('− Investissements', 'inv', { signed: true, sep: true }),
            tresoRow('= Variation de trésorerie', 'variation', { signed: true, style: 'bold' }),
            Object.assign(tresoRow('Trésorerie au 31 décembre', 'fin', { signed: true }), { style: 'highlight' }),
        ], { rowH: 14 });

        doc.font('Times-Italic').fontSize(8.5).fillColor(COLORS.muted)
            .text('Méthode : la CAF (Capacité d\'AutoFinancement) = Résultat net + Dotations aux amortissements − Reprises. Elle représente le cash-flow d\'exploitation réel, hors variation du BFR. Les dotations ne sont pas décaissées, elles ne doivent donc pas peser sur la trésorerie. Trésorerie comptabilisée à la date du rapport : ' + fmtEur(treso_actuelle) + '.',
                LEFT, y, { width: W, align: 'justify' });
        y = doc.y + 18;
    } else {
        sectionTitle('2. EXERCICE DE RÉFÉRENCE');
        doc.font('Times-Italic').fontSize(10).fillColor(COLORS.muted)
            .text('Le compte de résultat N-1 n\'a pu être chargé : aucune projection détaillée n\'est présentée dans ce rapport.',
                LEFT, y, { width: W });
        y = doc.y + 18;
    }

    // ============================================================
    // 5. OPINION DE L'EXPERT-COMPTABLE
    // ============================================================
    ensureSpace(140);
    sectionTitle('5. OPINION DE L\'EXPERT-COMPTABLE');
    doc.font('Times-Roman').fontSize(10).fillColor(COLORS.ink);
    const opinion = "Sur la base de nos travaux et des hypothèses retenues par la direction, nous n'avons pas relevé d'éléments qui nous conduiraient à considérer que les comptes prévisionnels présentés ne sont pas établis selon une méthodologie cohérente avec les principes de comptabilité prévisionnelle. Nous attirons toutefois l'attention sur le caractère prospectif de ces hypothèses : les chiffres futurs sont par nature incertains et peuvent différer significativement de la réalité.";
    doc.text(opinion, LEFT, y, { width: W, align: 'justify', lineGap: 2 });
    y = doc.y + 20;

    // ============================================================
    // SIGNATURE
    // ============================================================
    ensureSpace(120);
    doc.font('Times-Italic').fontSize(10).fillColor(COLORS.ink)
        .text('Fait à ' + ville_emission + ', le ' + formatDateFr(date_emission) + '.', LEFT, y, { width: W });
    y = doc.y + 30;

    const sigX = RIGHT - 220;
    doc.font('Times-Bold').fontSize(11).fillColor(COLORS.primary)
        .text(cabinet.signataire, sigX, y, { width: 220, align: 'right' });
    doc.font('Times-Italic').fontSize(9).fillColor(COLORS.muted)
        .text(cabinet.qualite, sigX, doc.y + 2, { width: 220, align: 'right' });

    if (sigPath) {
        try {
            doc.image(sigPath, sigX, doc.y + 8, { fit: [220, 60], align: 'right' });
        } catch (_) {}
    }

    // ============================================================
    // PIED DE PAGE (sur toutes les pages)
    // ============================================================
    const range = doc.bufferedPageRange();
    for (let p = 0; p < range.count; p++) {
        doc.switchToPage(range.start + p);
        const footY = 790;
        doc.moveTo(LEFT, footY - 6).lineTo(RIGHT, footY - 6).strokeColor(COLORS.hairline).lineWidth(0.3).stroke();
        doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
            .text(cabinet.nom + ' — ' + cabinet.adresse_1 + ', ' + cabinet.cp_ville + ' — SIREN ' + cabinet.siren,
                LEFT, footY, { width: W, align: 'center' });
        doc.text('Page ' + (p + 1) + ' / ' + range.count, LEFT, footY + 12, { width: W, align: 'center' });
    }

    // Helpers locaux
    function pctOf(part, total) {
        if (!total) return '—';
        const v = (part / total) * 100;
        return v.toFixed(1).replace('.', ',') + ' %';
    }

    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);
        doc.end();
    });
}
