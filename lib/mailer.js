// Sends the certificate PDF through Resend. Keys come from .env, never from the UI.
const { Resend } = require('resend');
const { escapeXml } = require('./template');

function fillPlaceholders(text, values) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (match, key) =>
    values[key] != null ? String(values[key]) : match
  );
}

function textToHtml(text) {
  return escapeXml(text).replace(/\r?\n/g, '<br>');
}

function resendClient() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is missing. Add it to your .env file.');
  }
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendCertificateEmail({ cert, subject, body, pdf }) {
  if (!process.env.RESEND_FROM) {
    throw new Error('RESEND_FROM is missing. Add a verified sender address to your .env file.');
  }
  const values = {
    name: cert.studentName,
    course: cert.course,
    instructor: cert.instructor,
    date: cert.date,
    id: cert.id,
  };
  const finalSubject = fillPlaceholders(subject, values);
  const finalText = fillPlaceholders(body, values);

  const { data, error } = await resendClient().emails.send({
    from: process.env.RESEND_FROM,
    to: [cert.email],
    subject: finalSubject,
    text: finalText,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#171717">${textToHtml(finalText)}</div>`,
    attachments: [
      { filename: `RootLine-Certificate-${cert.id}.pdf`, content: pdf.toString('base64') },
    ],
  });
  if (error) throw new Error(error.message || 'Resend rejected the email');
  return data.id;
}

module.exports = { sendCertificateEmail, fillPlaceholders };
