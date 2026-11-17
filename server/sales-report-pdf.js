const path = require('node:path');
const PDFDocument = require('pdfkit');
const { TIME_ZONE } = require('./sales-report');
const money = amount => `${BigInt(amount).toLocaleString('nb-NO')} kr`;
const dateTime = instant => new Intl.DateTimeFormat('nb-NO', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
    timeZoneName: 'longOffset', hourCycle: 'h23'
}).format(new Date(instant));

function renderSalesPdf(report) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 48, autoFirstPage: false,
            info: { Title: 'BodenBar – salgsrapport', Author: 'BodenBar', CreationDate: new Date(report.generatedAt) } });
        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        try {
            doc.registerFont('Body', path.join(__dirname, 'fonts/LiberationSans-Regular.ttf'));
            doc.registerFont('Bold', path.join(__dirname, 'fonts/LiberationSans-Bold.ttf'));
            doc.addPage();
            doc.font('Body');
            const font = doc._font.font;
            let replacedGlyph = false;
            const text = value => [...String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')].map(char => {
                const code = char.codePointAt(0);
                if (font.hasGlyphForCodePoint(code)) return char;
                replacedGlyph = true;
                return `[U+${code.toString(16).toUpperCase()}]`;
            }).join('');
            const width = doc.page.width - 96;
            const bottom = doc.page.height - 65;
            let page = 1;
            let y = 84;

            function addHeaderFooter(first = true) {
                // A width activates PDFKit's line wrapper even with lineBreak:false.
                // The footer is outside the body margins: draw it without wrapping
                // so it cannot advance to a new page before the header/body.
                doc.font('Body').fontSize(8).fillColor('#555555')
                    .text(`BodenBar · Salgsrapport · Side ${page}`, 48, doc.page.height - 43, { lineBreak: false });
                doc.font('Bold').fontSize(first ? 23 : 15).fillColor('#163c35')
                    .text(first ? 'Salgsrapport' : 'Salgsrapport – fortsettelse', 48, 45, { width });
            }

            function newPage() {
                doc.addPage();
                page++;
                addHeaderFooter(false);
                y = 77;
            }

            function checkBreak(need = 20) {
                if (y + need > bottom) newPage();
            }

            function paragraph(value, { size = 10, bold = false, color = '#202020', gap = 4 } = {}) {
                checkBreak();
                doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color);
                const content = text(value);
                const height = doc.heightOfString(content, { width, lineGap: 2 });
                if (y + height > bottom - 4 && y > 100) newPage();
                doc.font(bold ? 'Bold' : 'Body').fontSize(size).fillColor(color)
                    .text(content, 48, y, { width, lineGap: 2 });
                // Use explicit y + measured height, NOT doc.y (which is cursor position)
                y = y + height + gap;
            }

            addHeaderFooter(true);

            paragraph('Siste 30 dager · Europe/Oslo', { bold: true, size: 12, gap: 4 });
            paragraph(`Fra: ${dateTime(report.start)}`, { size: 9, color: '#555555', gap: 2 });
            paragraph(`Til: ${dateTime(report.end)}`, { size: 9, color: '#555555', gap: 2 });
            paragraph(`Generert: ${dateTime(report.generatedAt)}`, { size: 9, color: '#555555', gap: 12 });

            const { purchase, payment, correction } = report.totals;
            paragraph(`Salg: ${money(purchase.amount)}`, { bold: true, size: 17, gap: 4 });
            paragraph(`Serveringer: ${purchase.count} · Gratis serveringer: ${report.products.reduce((sum, item) => sum + item.freeCount, 0)}`, { gap: 12 });

            paragraph('Produkter', { bold: true, size: 13, gap: 4 });
            paragraph('Navn og beløp slik de er lagret på kjøpene.', { size: 9, color: '#555555', gap: 8 });

            const colX = [48, 293, 359, 416];
            const colWidths = [237, 58, 49, width - 368];

            function drawTableHeader() {
                doc.rect(48, y, width, 24).fill('#edf3f0');
                ['Produkt', 'Antall', 'Gratis', 'Salg'].forEach((label, i) => {
                    doc.font('Bold').fontSize(9).fillColor('#163c35').text(label, colX[i], y + 7,
                        { width: colWidths[i], align: i ? 'right' : 'left', lineBreak: false });
                });
                y += 31;
            }

            function tableRows(items) {
                return items.map(item => {
                    const cells = [text(item.name), String(item.count), String(item.freeCount), money(item.amount)];
                    doc.font('Body').fontSize(10);
                    const height = Math.max(20, ...cells.map((cell, i) =>
                        doc.heightOfString(cell, { width: colWidths[i], lineGap: 2 }) + 7));
                    return { cells, height };
                });
            }

            function drawProductTable(rows) {
                if (!rows.length) return;
                checkBreak(31 + rows[0].height);
                drawTableHeader();
                for (const row of rows) {
                    if (y + row.height > bottom) {
                        newPage();
                        drawTableHeader();
                    }
                    row.cells.forEach((cell, i) => {
                        doc.font('Body').fontSize(10).fillColor('#202020').text(cell, colX[i], y,
                            { width: colWidths[i], align: i ? 'right' : 'left', lineGap: 2 });
                    });
                    doc.moveTo(48, y + row.height - 4).lineTo(48 + width, y + row.height - 4)
                        .strokeColor('#dce5df').lineWidth(0.5).stroke();
                    y += row.height;
                }
            }

            if (!report.products.length) {
                paragraph('Ingen kjøp registrert i perioden.', { gap: 12 });
            } else {
                drawProductTable(tableRows(report.products));
            }
            y += 8;
            if (report.customers && report.customers.length) {
                paragraph('Kundedetaljer', { bold: true, size: 13, gap: 6 });
                paragraph('Kjøp per kunde i perioden. Navn og beløp slik de er lagret på kjøpene.', { size: 9, color: '#555555', gap: 6 });
                for (const cust of report.customers) {
                    const products = new Map();
                    for (const purchase of cust.purchases) {
                        const key = JSON.stringify([purchase.productId, purchase.productName]);
                        const item = products.get(key) || { name: purchase.productName, count: 0, freeCount: 0, amount: 0n };
                        const amount = BigInt(purchase.amount);
                        item.count++;
                        if (amount === 0n) item.freeCount++;
                        item.amount += amount;
                        products.set(key, item);
                    }
                    const rows = tableRows([...products.values()]);
                    const heading = `Kunde: ${text(cust.customerName)} – ${cust.totalCount} kjøp, ${money(cust.totalAmount)} (${cust.freeCount} gratis)`;
                    doc.font('Bold').fontSize(10);
                    const headingHeight = doc.heightOfString(text(heading), { width, lineGap: 2 });
                    checkBreak(headingHeight + 6 + (rows.length ? 31 + rows[0].height : 0));
                    paragraph(heading, { bold: true, size: 10, gap: 6 });
                    drawProductTable(rows);
                    y += 5;
                    if (cust.purchases.length) {
                        checkBreak(45);
                        paragraph('Kjøpshistorikk', { bold: true, size: 9, gap: 4 });
                    }
                    for (const purchase of cust.purchases) {
                        checkBreak(18);
                        const ts = new Date(purchase.timestamp);
                        const timeStr = ts.toLocaleString('nb-NO', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hourCycle: 'h23' });
                        paragraph(`  ${timeStr} – ${text(purchase.productName)}: ${money(purchase.amount)}`, { size: 9, gap: 2 });
                    }
                    y += 3;
                }
            }
            y += 6;
            paragraph('Innbetalinger og korrigeringer', { bold: true, size: 13, gap: 6 });
            paragraph(`Innbetalinger: ${money(payment.amount)} (${payment.count} registreringer)\nSeparate korrigeringer: ${money(correction.amount)} (${correction.count} registreringer)`, { gap: 15 });
            paragraph('Salg og innbetalinger er forskjellige størrelser og er ikke lagt sammen. Redigerte kjøp inngår én gang i salg med sitt lagrede beløp.', { size: 9, color: '#555555' });
            paragraph('Rapporten viser transaksjonene som fortsatt finnes ved generering. Slettede kunder, tømt historikk og angrede kjøp kan fjerne poster. Redigerte kjøp beholder opprinnelig dato. Arkiver kunder for å bevare historikken.', { size: 9, color: '#555555' });
            paragraph('Historiske Fat/Medlem-flagg er ikke lagret på kjøpene og kan ikke fordeles sikkert. Rapporten er en driftsoversikt, ikke et revidert regnskap.', { size: 9, color: '#555555' });
            if (replacedGlyph) paragraph('Tegn som ikke finnes i rapportskriften vises med Unicode-koden sin, for eksempel [U+1F37A].', { size: 8, color: '#555555' });
            doc.end();
        } catch (error) {
            doc.destroy();
            reject(error);
        }
    });
}
module.exports = { renderSalesPdf };