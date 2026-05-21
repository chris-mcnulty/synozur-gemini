/**
 * Render an HTML string to a PDF buffer using puppeteer. Used by the 941
 * quarterly return generator and any future "printable HTML → PDF"
 * payroll/tax form. Mirrors the puppeteer launch options already used by
 * the contractor invoice and invoice-batch PDF paths so we get the same
 * sandbox / chromium-resolution behaviour everywhere.
 */
export async function htmlToPdf(html: string, opts: {
  format?: 'Letter' | 'Legal' | 'A4';
  margin?: { top: string; right: string; bottom: string; left: string };
} = {}): Promise<Buffer> {
  const puppeteer = await import('puppeteer');
  let executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (!executablePath) {
    try {
      const { execSync } = await import('child_process');
      executablePath = execSync('which chromium').toString().trim();
    } catch {
      executablePath = 'chromium';
    }
  }
  const browser = await puppeteer.default.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--single-process',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: opts.format ?? 'Letter',
      printBackground: true,
      margin: opts.margin ?? { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
    });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
