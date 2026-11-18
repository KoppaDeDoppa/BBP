const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { openDatabase, getRevision } = require('../server/database');
const { createUser, createSession, SESSION_COOKIE } = require('../server/auth');
const { makeApi } = require('../server/api');
const keg = require('../server/estimated-keg');

const SECRET = 'estimated-keg-test-only-secret-123456789';
async function fixture(t, env = { KEG_TRACKING_SECRET: SECRET }) {
    const db = openDatabase(':memory:');
    const admin = await createUser(db, { username: 'keg-admin', password: 'test-password-admin', role: 'admin' });
    const staff = await createUser(db, { username: 'keg-staff', password: 'test-password-staff', role: 'staff' });
    const cookies = Object.fromEntries([admin, staff].map(user => [user.role, `${SESSION_COOKIE}=${createSession(db, user.id)}`]));
    const app = express();
    app.use(express.json());
    app.use('/api', makeApi(db, { env }));
    app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
        db.close();
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    async function api(route, body, options = {}) {
        const { role = 'admin', method = body === undefined ? 'GET' : 'POST', bearer, crossOrigin } = options;
        const headers = { origin: crossOrigin || origin };
        if (role) headers.cookie = cookies[role];
        if (bearer !== undefined) headers.authorization = bearer;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const response = await fetch(`${origin}/api${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: response.status, headers: response.headers, data: await response.json() };
    }
    const state = async () => (await api('/state')).data;
    const configure = (input = {}) => api('/admin/estimated-keg', { enabled: true, capacityLitres: 30, productIds: ['beer', 'beer-member'], ...input }, { method: 'PUT' });
    const customerId = (await api('/customers', { name: 'Keg test customer' })).data.id;
    const buy = productId => api('/transactions/purchase', { customerId, productId });
    const undo = () => api(`/transactions/undo/${customerId}`, {});
    const correct = (id, productId, amount = 0) => api(`/transactions/${id}/correct`, { productId, amount });
    return { db, api, state, configure, buy, undo, correct, customerId };
}

test('disabled setup, strict configuration, roles, and integration authentication', async t => {
    const f = await fixture(t);
    const initial = (await f.state()).estimatedKeg;
    assert.equal(initial.enabled, false);
    assert.equal(initial.capacityMl, 0);
    assert.equal(initial.servingMl, 500);
    assert.equal((await f.configure({ enabled: false, capacityLitres: 0, productIds: [] })).status, 200);
    assert.equal((await f.configure()).status, 400);
    assert.equal((await f.buy('beer')).data.consumption, null);
    for (const input of [
        { currentLitres: 31 }, { currentLitres: -1 }, { currentLitres: '30' },
        { currentLitres: 0.0001 }, { capacityLitres: 0 }, { capacityLitres: 1e20 },
        { productIds: [] }, { productIds: ['missing'] }, { productIds: ['beer', 'beer'] },
        { enabled: 'true' }
    ]) assert.equal((await f.configure({ currentLitres: 30, ...input })).status, 400);
    const body = { enabled: true, capacityLitres: 30, currentLitres: 30, productIds: ['beer'] };
    assert.equal((await f.api('/admin/estimated-keg', body, { method: 'PUT', role: 'staff' })).status, 403);
    assert.equal((await f.api('/admin/estimated-keg', body, { method: 'PUT', role: null })).status, 401);
    assert.equal((await f.api('/admin/estimated-keg', body, { method: 'PUT', crossOrigin: 'https://evil.example' })).status, 403);
    const integration = bearer => f.api('/integrations/kegs', undefined, { role: null, bearer });
    for (const token of [undefined, SECRET, 'Bearer wrong', `bearer ${SECRET}`]) assert.equal((await integration(token)).status, 401);
    const disabled = await integration(`Bearer ${SECRET}`);
    assert.equal(disabled.status, 200);
    assert.deepEqual(disabled.data, { kegs: [] });
    assert.equal(disabled.headers.get('cache-control'), 'no-store');
    assert.equal((await f.configure({ currentLitres: 30 })).status, 200);
    const snapshot = await integration(`Bearer ${SECRET}`);
    assert.deepEqual(Object.keys(snapshot.data), ['kegs']);
    assert.deepEqual(snapshot.data.kegs, [{ id: 'helles-lager', source: 'estimated', amount_left: 30, max_keg_volume: 30, percent_of_beer_left: 100, updatedAt: (await f.state()).estimatedKeg.updatedAt }]);
    const before = await f.state();
    await integration(`Bearer ${SECRET}`);
    assert.deepEqual(await f.state(), before);
    assert.ok(!JSON.stringify(snapshot.data).includes(f.customerId));
});

test('invalid or missing integration secret returns unavailable, never disabled snapshot', async t => {
    const env = {};
    const f = await fixture(t, env);
    for (const secret of [undefined, '', 'short', 'a'.repeat(31), ' '.repeat(32), 'a'.repeat(32) + '\n', 'é'.repeat(32)]) {
        env.KEG_TRACKING_SECRET = secret;
        const result = await f.api('/integrations/kegs', undefined, { role: null, bearer: `Bearer ${SECRET}` });
        assert.equal(result.status, 503);
        assert.equal(result.headers.get('cache-control'), 'no-store');
        assert.equal(result.data.kegs, undefined);
    }
});

test('mapped/free and unmapped purchases, correction provenance, mapping changes, price neutrality', async t => {
    const f = await fixture(t);
    const legacy = (await f.buy('whisky')).data;
    await f.configure({ currentLitres: 30 });
    await f.correct(legacy.id, 'beer', 50);
    assert.equal((await f.state()).estimatedKeg.remainingMl, 30000);
    const mapped = (await f.buy('beer')).data;
    assert.equal(mapped.consumption.ml, 500);
    assert.equal((await f.buy('beer-member')).data.consumption.ml, 500);
    const unmapped = (await f.buy('whisky')).data;
    assert.equal(unmapped.consumption.ml, 0);
    assert.equal(unmapped.consumption.cycleId, mapped.consumption.cycleId);
    assert.equal((await f.state()).estimatedKeg.remainingMl, 29000);
    await f.correct(unmapped.id, 'beer');
    assert.equal((await f.state()).estimatedKeg.remainingMl, 28500);
    await f.correct(unmapped.id, 'beer', 999);
    assert.equal((await f.state()).estimatedKeg.remainingMl, 28500);
    await f.correct(unmapped.id, 'whisky');
    assert.equal((await f.state()).estimatedKeg.remainingMl, 29000);
    const before = (await f.state()).estimatedKeg;
    await f.configure({ productIds: ['beer-member'] });
    await f.correct(mapped.id, 'beer', 1);
    assert.equal((await f.state()).estimatedKeg.remainingMl, 29000, 'price-only edit must retain original attribution after mapping change');
    assert.equal((await f.state()).estimatedKeg.cycleId, before.cycleId);
    await f.undo();
    await f.undo();
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 30000);
});

test('oversell preserves raw negative balance and undo reconciles raw rather than clamped display', async t => {
    const f = await fixture(t);
    await f.configure({ currentLitres: 0.5 });
    await Promise.all([f.buy('beer'), f.buy('beer'), f.buy('beer')]);
    let state = await f.state();
    assert.equal(state.estimatedKeg.rawRemainingMl, -1000);
    assert.equal(state.estimatedKeg.remainingMl, 0);
    await f.undo();
    state = await f.state();
    assert.equal(state.estimatedKeg.rawRemainingMl, -500);
    assert.equal(state.estimatedKeg.remainingMl, 0);
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 0);
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 500);
});

test('config preserves cycle, calibration/reset isolate old corrections and reversals', async t => {
    const f = await fixture(t);
    await f.configure({ currentLitres: 30 });
    const old = (await f.buy('beer')).data;
    const before = (await f.state()).estimatedKeg;
    const edited = await f.configure({ capacityLitres: 40 });
    assert.equal(edited.data.cycleId, before.cycleId);
    assert.equal(edited.data.rawRemainingMl, before.rawRemainingMl);
    assert.equal((await f.configure({ capacityLitres: 20 })).status, 400);
    assert.deepEqual((await f.state()).estimatedKeg, edited.data);
    const calibrated = await f.configure({ currentLitres: 20 });
    assert.notEqual(calibrated.data.cycleId, before.cycleId);
    await f.correct(old.id, 'whisky');
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 20000);
    const tracked = (await f.buy('beer')).data;
    const reset = await f.api('/admin/estimated-keg/reset', {});
    assert.equal(reset.status, 200);
    assert.equal(reset.data.remainingMl, 30000);
    assert.notEqual(reset.data.cycleId, tracked.consumption.cycleId);
    await f.correct(tracked.id, 'whisky');
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 30000);
    await f.configure({ enabled: false });
    assert.equal((await f.buy('beer')).data.consumption, null);
    await f.configure();
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 30000);
});

test('failed purchase/correction rolls back consumption, customer balance, and revision atomically', async t => {
    const f = await fixture(t);
    await f.configure({ currentLitres: 30 });
    const before = await f.state();
    assert.equal((await f.buy('missing')).status, 400);
    assert.deepEqual(await f.state(), before);
    f.db.exec(`CREATE TRIGGER reject_revision BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    assert.equal((await f.buy('beer')).status, 500);
    assert.deepEqual(await f.state(), before);
    f.db.exec('DROP TRIGGER reject_revision');
    const purchase = (await f.buy('whisky')).data;
    const after = await f.state();
    f.db.exec(`CREATE TRIGGER reject_revision BEFORE UPDATE ON metadata BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
    assert.equal((await f.correct(purchase.id, 'beer')).status, 500);
    assert.deepEqual(await f.state(), after);
});

test('payment, customer deletion and clear preserve physical estimate; unused product removal prunes mappings', async t => {
    const f = await fixture(t);
    await f.configure({ currentLitres: 30 });
    await f.buy('beer');
    await f.api(`/transactions/settle/${f.customerId}`, {});
    assert.equal((await f.state()).estimatedKeg.remainingMl, 29500);
    await f.api(`/customers/${f.customerId}`, undefined, { method: 'DELETE' });
    assert.equal((await f.state()).estimatedKeg.remainingMl, 29500);
    const product = (await f.api('/products', { name: 'Temporary keg', price: 0, icon: 'T' })).data;
    await f.configure({ productIds: [product.id] });
    await f.api(`/products/${product.id}`, { ...product, name: 'Renamed' }, { method: 'PUT' });
    assert.deepEqual((await f.state()).estimatedKeg.productIds, [product.id]);
    await f.api(`/products/${product.id}`, undefined, { method: 'DELETE' });
    assert.deepEqual((await f.state()).estimatedKeg.productIds, []);
    assert.equal((await f.state()).estimatedKeg.enabled, false);
    await f.configure({ productIds: ['beer'] });
    const before = (await f.state()).estimatedKeg;
    await f.api('/admin/clear', {});
    const after = (await f.state()).estimatedKeg;
    assert.equal(after.rawRemainingMl, before.rawRemainingMl);
    assert.notEqual(after.cycleId, before.cycleId);
    assert.deepEqual(after.productIds, ['beer']);
});

test('v3 full backup restores keg/provenance; v2 preserves physical volume and isolates imported history', async t => {
    const f = await fixture(t);
    await f.configure({ currentLitres: 30 });
    const purchase = (await f.buy('beer')).data;
    const backup = (await f.api('/admin/backup')).data;
    assert.equal(backup.version, 3);
    assert.deepEqual(backup.estimatedKeg, (await f.state()).estimatedKeg);
    assert.deepEqual(backup.transactions[0].consumption, purchase.consumption);
    await f.api('/admin/estimated-keg/reset', {});
    assert.equal((await f.api('/admin/restore', backup)).status, 200);
    assert.deepEqual((await f.state()).estimatedKeg, backup.estimatedKeg);
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, 30000);
    const before = (await f.state()).estimatedKeg;
    const legacy = { ...backup, version: 2, products: backup.products.filter(product => product.id !== 'beer-member') };
    delete legacy.estimatedKeg;
    legacy.transactions.forEach(tx => delete tx.consumption);
    assert.equal((await f.api('/admin/restore', legacy)).status, 200);
    let state = await f.state();
    assert.equal(state.estimatedKeg.rawRemainingMl, before.rawRemainingMl);
    assert.notEqual(state.estimatedKeg.cycleId, before.cycleId);
    assert.deepEqual(state.estimatedKeg.productIds, ['beer']);
    assert.equal(state.transactions[0].consumption, null);
    await f.correct(purchase.id, 'beer-member'); // Missing product is rejected without touching keg.
    await f.undo();
    assert.equal((await f.state()).estimatedKeg.remainingMl, before.remainingMl);
    const stable = await f.state();
    const invalidBackups = [
        { ...backup, estimatedKeg: null },
        { ...backup, estimatedKeg: { ...backup.estimatedKeg, rawRemainingMl: 1.5 } },
        { ...backup, estimatedKeg: { ...backup.estimatedKeg, productIds: ['missing'] } },
        { ...backup, estimatedKeg: { ...backup.estimatedKeg, servingMl: 1000 } },
        { ...backup, transactions: backup.transactions.map(tx => ({ ...tx, consumption: { cycleId: '', ml: 500 } })) },
        { ...backup, transactions: backup.transactions.map(tx => ({ ...tx, consumption: { cycleId: 'cycle', ml: 501 } })) }
    ];
    for (const invalid of invalidBackups) {
        assert.equal((await f.api('/admin/restore', invalid)).status, 400);
        assert.deepEqual(await f.state(), stable);
    }
});

test('migration leaves legacy purchases unattributed and keg survives repeated database reopen', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bodenbar-keg-test-'));
    const filename = path.join(directory, 'test.sqlite');
    let db;
    try {
        db = openDatabase(filename);
        db.exec('DROP TABLE estimated_keg_products; DROP TABLE estimated_keg; ALTER TABLE transactions DROP COLUMN consumption_cycle_id; ALTER TABLE transactions DROP COLUMN consumed_ml;');
        db.exec(`INSERT INTO customers VALUES ('customer', 'Legacy customer', 50, 0, '2025-01-01', '2025-01-01');
            INSERT INTO transactions (id, customer_id, type, product_id, product_name, amount, price, timestamp)
            VALUES ('purchase', 'customer', 'purchase', 'beer', 'Beer', 50, 50, '2025-01-01');`);
        db.close();
        db = openDatabase(filename);
        assert.equal(db.prepare('SELECT consumption_cycle_id FROM transactions').get().consumption_cycle_id, null);
        keg.configure(db, { enabled: true, capacityLitres: 30, currentLitres: 12.345, productIds: ['beer'] });
        const expected = keg.get(db);
        const revision = getRevision(db);
        db.close();
        db = openDatabase(filename);
        assert.deepEqual(keg.get(db), expected);
        assert.equal(getRevision(db), revision);
    } finally {
        if (db?.open) db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
