const crypto = require('node:crypto');

const ID = 'helles-lager';
const SERVING_ML = 500;
function invalid(message = 'Ugyldige data for estimert fat.') {
    const error = new Error(message);
    error.status = 400;
    throw error;
}
function initialise(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS estimated_keg (
        id TEXT PRIMARY KEY CHECK (id = 'helles-lager'), enabled INTEGER NOT NULL,
        capacity_ml INTEGER NOT NULL, raw_remaining_ml INTEGER NOT NULL,
        cycle_id TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS estimated_keg_products (
        product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE
    );`);
    db.prepare('INSERT OR IGNORE INTO estimated_keg VALUES (?, 0, 0, 0, ?, ?)')
        .run(ID, crypto.randomUUID(), new Date().toISOString());
    const columns = db.pragma('table_info(transactions)');
    if (!columns.some(column => column.name === 'consumption_cycle_id')) db.exec('ALTER TABLE transactions ADD COLUMN consumption_cycle_id TEXT');
    if (!columns.some(column => column.name === 'consumed_ml')) db.exec('ALTER TABLE transactions ADD COLUMN consumed_ml INTEGER');
}
function get(db) {
    const row = db.prepare('SELECT * FROM estimated_keg WHERE id = ?').get(ID);
    return {
        id: ID, enabled: Boolean(row.enabled), capacityMl: row.capacity_ml,
        remainingMl: Math.max(0, Math.min(row.capacity_ml, row.raw_remaining_ml)),
        rawRemainingMl: row.raw_remaining_ml, cycleId: row.cycle_id,
        productIds: db.prepare('SELECT product_id FROM estimated_keg_products ORDER BY product_id').all().map(row => row.product_id),
        servingMl: SERVING_ML, updatedAt: row.updated_at
    };
}
function save(db, state) {
    db.prepare(`UPDATE estimated_keg SET enabled = ?, capacity_ml = ?, raw_remaining_ml = ?, cycle_id = ?, updated_at = ? WHERE id = ?`)
        .run(Number(state.enabled), state.capacityMl, state.rawRemainingMl, state.cycleId, state.updatedAt, ID);
    db.prepare('DELETE FROM estimated_keg_products').run();
    const insert = db.prepare('INSERT INTO estimated_keg_products VALUES (?)');
    state.productIds.forEach(id => insert.run(id));
}
function litres(value, positive = false) {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
    const ml = Math.round(value * 1000);
    if (!Number.isSafeInteger(ml) || ml < (positive ? 1 : 0) || Math.abs(value * 1000 - ml) > 1e-7) invalid();
    return ml;
}
function products(ids, available) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !available.has(id)) || new Set(ids).size !== ids.length) invalid();
    return [...ids].sort();
}
function configure(db, input) {
    if (!input || typeof input.enabled !== 'boolean') invalid();
    const state = get(db);
    const capacityMl = litres(input.capacityLitres, input.enabled || state.capacityMl > 0);
    const productIds = products(input.productIds, new Set(db.prepare('SELECT id FROM products').all().map(row => row.id)));
    if (input.enabled && !productIds.length) invalid('Velg minst ett produkt.');
    const calibration = Object.hasOwn(input, 'currentLitres');
    if (!calibration && capacityMl < state.remainingMl) invalid('Kapasiteten er mindre enn nåværende volum. Oppgi en eksplisitt justering.');
    if (capacityMl > 0 && !state.capacityMl && !calibration) invalid('Oppgi nåværende volum ved første oppsett.');
    const rawRemainingMl = calibration ? litres(input.currentLitres) : state.rawRemainingMl;
    if (calibration && rawRemainingMl > capacityMl) invalid();
    save(db, { ...state, enabled: input.enabled, capacityMl, productIds, rawRemainingMl,
        cycleId: calibration ? crypto.randomUUID() : state.cycleId, updatedAt: new Date().toISOString() });
    return get(db);
}
function reset(db) {
    const state = get(db);
    if (!state.capacityMl || !state.productIds.length) invalid('Konfigurer fatet før nullstilling.');
    save(db, { ...state, rawRemainingMl: state.capacityMl, cycleId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
    return get(db);
}
function adjust(db, delta) {
    const state = get(db);
    const raw = state.rawRemainingMl + delta;
    if (!Number.isSafeInteger(raw)) invalid('Fatvolumet er utenfor gyldig område.');
    db.prepare('UPDATE estimated_keg SET raw_remaining_ml = ?, updated_at = ? WHERE id = ?').run(raw, new Date().toISOString(), ID);
}
function purchase(db, transactionId, productId) {
    const state = get(db);
    if (!state.enabled) return null;
    const consumption = { cycleId: state.cycleId, ml: state.productIds.includes(productId) ? SERVING_ML : 0 };
    db.prepare('UPDATE transactions SET consumption_cycle_id = ?, consumed_ml = ? WHERE id = ?').run(consumption.cycleId, consumption.ml, transactionId);
    if (consumption.ml) adjust(db, -consumption.ml);
    return consumption;
}
function undo(db, transaction) {
    if (transaction.consumption_cycle_id === get(db).cycleId && transaction.consumed_ml) adjust(db, transaction.consumed_ml);
}
function correct(db, transaction, productId) {
    const state = get(db);
    if (transaction.consumption_cycle_id === state.cycleId && transaction.product_id !== productId) {
        const ml = state.productIds.includes(productId) ? SERVING_ML : 0;
        if (ml !== transaction.consumed_ml) adjust(db, transaction.consumed_ml - ml);
        db.prepare('UPDATE transactions SET consumed_ml = ? WHERE id = ?').run(ml, transaction.id);
        return { cycleId: state.cycleId, ml };
    }
    return transaction.consumption_cycle_id === null ? null : { cycleId: transaction.consumption_cycle_id, ml: transaction.consumed_ml };
}
function validateBackup(state, productIds) {
    if (!state || state.id !== ID || typeof state.enabled !== 'boolean' || state.servingMl !== SERVING_ML ||
        !Number.isSafeInteger(state.capacityMl) || state.capacityMl < 0 ||
        !Number.isSafeInteger(state.rawRemainingMl) ||
        state.remainingMl !== Math.max(0, Math.min(state.capacityMl, state.rawRemainingMl)) ||
        typeof state.cycleId !== 'string' || !state.cycleId.trim() || state.cycleId.length > 64 ||
        typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt))) invalid();
    const ids = products(state.productIds, productIds);
    if (state.enabled && (!state.capacityMl || !ids.length)) invalid();
    return { ...state, productIds: ids };
}
function validateConsumption(value, type) {
    if (value === null) return null;
    if (!value || type !== 'purchase' || typeof value.cycleId !== 'string' || !value.cycleId.trim() || value.cycleId.length > 64 || ![0, SERVING_ML].includes(value.ml)) invalid('Ugyldig fatforbruk i sikkerhetskopien.');
    return { cycleId: value.cycleId, ml: value.ml };
}
function retain(db, state) {
    const available = new Set(db.prepare('SELECT id FROM products').all().map(row => row.id));
    const productIds = state.productIds.filter(id => available.has(id));
    save(db, { ...state, productIds, enabled: state.enabled && productIds.length > 0, cycleId: crypto.randomUUID(), updatedAt: new Date().toISOString() });
}
function prune(db) {
    const state = get(db);
    if (state.enabled && !state.productIds.length) save(db, { ...state, enabled: false, updatedAt: new Date().toISOString() });
}
module.exports = { initialise, get, configure, reset, purchase, undo, correct, save, validateBackup, validateConsumption, retain, prune };
