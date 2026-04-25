// ============================================================================
// Service d'envoi d'emails (factures → Pennylane, notifications cabinet…)
// Nodemailer avec SMTP — secrets lus depuis la table api_credentials
// ============================================================================

import nodemailer from 'nodemailer';
import { getSecret } from './secrets.js';

// Cache du transporter : on le recrée si la config a changé (host/user/pass).
let transporter = null;
let transporterSig = null;

async function getTransporter() {
    const host = await getSecret('smtp_host');
    const portRaw = await getSecret('smtp_port');
    const user = await getSecret('smtp_user');
    const pass = await getSecret('smtp_pass');
    const port = Number(portRaw) || 587;

    if (!host || !user || !pass) {
        console.warn('[mailer] SMTP non configuré — saisir les secrets SMTP dans Admin → Paramètres & Connexions');
        return null;
    }

    const sig = `${host}|${port}|${user}|${pass}`;
    if (transporter && transporterSig === sig) return transporter;

    transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
    transporterSig = sig;
    return transporter;
}

/**
 * Envoie un email avec une pièce jointe.
 * @param {Object} opts
 * @param {string} opts.to - destinataire
 * @param {string} opts.subject - sujet
 * @param {string} opts.text - corps texte
 * @param {string} [opts.html] - corps HTML (optionnel)
 * @param {Array} [opts.attachments] - [{ filename, content: Buffer, contentType }]
 * @returns {Promise<{ok: boolean, messageId?: string, error?: string}>}
 */
export async function sendMailWithAttachment({ to, subject, text, html, attachments = [] }) {
    const t = await getTransporter();
    if (!t) return { ok: false, error: 'smtp_not_configured' };

    const from = (await getSecret('smtp_from')) || (await getSecret('smtp_user'));
    try {
        const info = await t.sendMail({
            from,
            to,
            subject,
            text,
            html,
            attachments
        });
        return { ok: true, messageId: info.messageId };
    } catch (err) {
        console.error('[mailer] send failed:', err.message);
        return { ok: false, error: String(err.message || err) };
    }
}

export async function isSmtpConfigured() {
    const host = await getSecret('smtp_host');
    const user = await getSecret('smtp_user');
    const pass = await getSecret('smtp_pass');
    return !!(host && user && pass);
}
