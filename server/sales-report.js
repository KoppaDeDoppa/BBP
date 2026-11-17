const TIME_ZONE = 'Europe/Oslo';
const calendar = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
function wallTime(instant) {
    const date = new Date(instant);
    const p = Object.fromEntries(calendar.formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, date.getUTCMilliseconds());
}
function rollingPeriod(now = new Date()) {
    const end = new Date(now).getTime();
    if (!Number.isFinite(end)) throw new Error('Ugyldig rapporttidspunkt.');
    const target = new Date(wallTime(end));
    target.setUTCDate(target.getUTCDate() - 30);
    const wall = target.getTime();
    // Sample both offsets around a possible Oslo DST transition. For an overlap,
    // choose the earlier instant; for a gap, advance by the size of the gap.
    const offsets = new Set([-2, 0, 2].map(days => {
        const instant = wall + days * 86_400_000;
        return wallTime(instant) - instant;
    }));
    const candidates = [...offsets].map(offset => wall - offset);
    const matching = candidates.filter(instant => wallTime(instant) === wall).sort((a, b) => a - b);
    const start = matching[0] ?? candidates.filter(instant => wallTime(instant) > wall)
        .sort((a, b) => wallTime(a) - wallTime(b))[0];
    if (!Number.isFinite(start)) throw new Error('Kunne ikke beregne rapportperioden.');
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), timeZone: TIME_ZONE };
}
function generateReport(db, now = new Date()) {
    const range = rollingPeriod(now);
    // Keep the read transaction synchronous; PDF rendering happens after it ends.
    return db.transaction(() => {
        const totals = { purchase: { count: 0, amount: 0n }, payment: { count: 0, amount: 0n }, correction: { count: 0, amount: 0n } };
        const products = new Map();
        const customers = new Map();
        // Load customer names for the report
        const customerNames = new Map();
        for (const row of db.prepare('SELECT id, name FROM customers').iterate()) {
            customerNames.set(row.id, row.name);
        }
        const rows = db.prepare('SELECT type, customer_id, product_id, product_name, amount, timestamp FROM transactions ORDER BY sequence').safeIntegers().iterate();
        for (const row of rows) {
            const timestamp = new Date(row.timestamp);
            if (typeof row.timestamp !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(row.timestamp) ||
                !Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== row.timestamp) {
                throw new Error('Ugyldig transaksjonsdato; rapporten kunne ikke lages.');
            }
            if (row.timestamp < range.start || row.timestamp > range.end) continue;
            if (!Object.hasOwn(totals, row.type) || typeof row.amount !== 'bigint' ||
                row.amount > BigInt(Number.MAX_SAFE_INTEGER) || row.amount < BigInt(Number.MIN_SAFE_INTEGER) ||
                (row.type !== 'correction' && row.amount < 0n)) {
                throw new Error('Ugyldig transaksjonsbeløp eller type; rapporten kunne ikke lages.');
            }
            totals[row.type].count++;
            totals[row.type].amount += row.amount;
            if (row.type === 'purchase') {
                if (typeof row.product_id !== 'string' || typeof row.product_name !== 'string') throw new Error('Ugyldige produktdata.');
                const pkey = JSON.stringify([row.product_id, row.product_name]);
                const item = products.get(pkey) || { productId: row.product_id, name: row.product_name, count: 0, freeCount: 0, amount: 0n };
                item.count++;
                if (row.amount === 0n) item.freeCount++;
                item.amount += row.amount;
                products.set(pkey, item);
                // Customer breakdown
                const ckey = row.customer_id;
                const cust = customers.get(ckey) || { customerId: ckey, customerName: customerNames.get(ckey) || 'Ukjent kunde', purchases: [], totalAmount: 0n, totalCount: 0, freeCount: 0 };
                cust.purchases.push({ productId: row.product_id, productName: row.product_name, amount: row.amount, timestamp: row.timestamp });
                cust.totalAmount += row.amount;
                cust.totalCount++;
                if (row.amount === 0n) cust.freeCount++;
                customers.set(ckey, cust);
            }
        }
        return { ...range, generatedAt: range.end, currency: 'NOK',
            totals: Object.fromEntries(Object.entries(totals).map(([type, value]) => [type, { ...value, amount: String(value.amount) }])),
            products: [...products.values()].map(item => ({ ...item, amount: String(item.amount) })),
            customers: [...customers.values()].map(cust => ({
                ...cust,
                totalAmount: String(cust.totalAmount),
                purchases: cust.purchases.map(p => ({ ...p, amount: String(p.amount) }))
            })) };
    })();
}
module.exports = { TIME_ZONE, rollingPeriod, generateReport };
