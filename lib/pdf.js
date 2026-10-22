// Turns the certificate HTML into an A4 landscape PDF with headless Chrome (installed by puppeteer).
const puppeteer = require('puppeteer');
const { certificateHtml } = require('./template');

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.env.CHROME_PATH || undefined,
    });
  }
  return browserPromise;
}

async function certificatePdf(cert) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(certificateHtml(cert, { forPdf: true }), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

async function closePdfBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

module.exports = { certificatePdf, closePdfBrowser };
