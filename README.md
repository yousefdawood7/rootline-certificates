# RootLine Certificates

Build certificates from a spreadsheet, check every one in a live preview, then email each PDF
through Resend. The design is the same one from your PowerPoint, including the signature,
logo, borders and fonts.

## 1. Install

You need Node.js 18 or newer.

```bash
npm install
```

`npm install` also downloads a headless Chrome (used by puppeteer to turn the certificate into a PDF).
If that step was skipped or failed, run:

```bash
npx puppeteer browsers install chrome
```

## 2. Configure Resend

```bash
cp .env.example .env
```

Edit `.env`:

- `RESEND_API_KEY`: your Resend API key.
- `RESEND_FROM`: a sender on a domain you verified in Resend, for example `RootLine <certificates@yourdomain.com>`.

Keys stay in `.env` on your machine. The UI never shows or stores them.

## 3. Run

```bash
npm start
```

Open http://localhost:3000

## How to use it

1. **Import** your spreadsheet (`.xlsx`, `.xls` or `.csv`). The app suggests which column is
   the student name, email, course, instructor and date. Check the mapping, set defaults for
   anything missing, then click **Create drafts**. Each row gets its own certificate ID.
   Rows without a valid name or email are skipped and listed.
2. **Or add one** certificate with the form in section 2.
3. **Review** each certificate. Click it in the list, or use Previous and Next. The live
   preview shows the exact certificate that will be emailed. Edits update the preview.
4. **Write the email** in section 3. Placeholders: `{{name}}`, `{{course}}`, `{{instructor}}`,
   `{{date}}`, `{{id}}`.
5. **Send**: "Send this one" sends the selected certificate. "Send all pending" sends every
   draft and failed certificate in order, with a progress bar. Each email carries the PDF.

Sent certificates are locked so the record and the PDF stay in step.

## Certificate IDs

IDs look like `RL-2026-K7Q3M9XD`. The year is the current year, and the last 8 characters are
random. The alphabet leaves out look-alike characters (0/O and 1/I/L). Every ID is checked
against the local store before it is used, so it stays unique. An ID is assigned when a
certificate is created and does not change afterwards.

## Where data is stored

Everything is local: `data/store.json` holds every certificate, its status, its Resend message
ID, and the saved email message. Back up that file if you need the history. Delete it to start
fresh.

## Changing the design

The template in `templates/certificate.svg` was extracted from your PowerPoint. If you edit the
slide, unzip the `.pptx`, then run:

```bash
python3 tools/extract_template.py path/to/ppt/slides/slide1.xml templates/certificate.svg
```

The placeholders stay the same, so the rest of the app keeps working.

## Notes and limits

- Resend limits sending speed, so batches wait about 0.6 seconds between emails
  (`SEND_DELAY_MS` in `.env`).
- Long names and course titles are shrunk to fit the same box the PowerPoint uses.
- The date uses the month and year format from the design ("October 2026"). Type any other
  text into the Date field to change it for one certificate.
