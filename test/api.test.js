const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { openDatabase } = require('../server/database');
const { createUser, createSession, SESSION_COOKIE } = require('../server/auth');
const { makeApi } = require('../server/api');

const db = openDatabase(':memory:');
const app = express();
app.use(express.json());
app.use('/api', makeApi(db));
const server = app.listen(0, '127.0.0.1');
const ready = new Promise(resolve => server.once('listening', resolve));
after(() => { server.close(); db.close(); });

async function request(path, { method = 'GET', body, cookie, origin, targetServer = server } = {}) {
    await ready;
    const address = targetServer.address();
    const url = `http://127.0.0.1:${address.port}/api${path}`;
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (origin !== null) headers.origin = origin || `http://127.0.0.1:${address.port}`;
    const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { response, data: text ? JSON.parse(text) : null };
}

async function productFixture(t) {
    const isolatedDb = openDatabase(':memory:');
    t.after(() => isolatedDb.close());
    const admin = await createUser(isolatedDb, { username: 'product-admin', password: 'test-password-admin', role: 'admin' });
    const cookie = `${SESSION_COOKIE}=${createSession(isolatedDb, admin.id)}`;
    const isolatedApp = express();
    isolatedApp.use(express.json());
    isolatedApp.use('/api', makeApi(isolatedDb));
    isolatedApp.use((error, _req, res, _next) => {
        res.status(error.status || 500).json({ error: error.message });
    });
    const isolatedServer = isolatedApp.listen(0, '127.0.0.1');
    await new Promise(resolve => isolatedServer.once('listening', resolve));
    t.after(() => new Promise((resolve, reject) => {
        isolatedServer.close(error => error ? reject(error) : resolve());
        isolatedServer.closeIdleConnections();
    }));
    return (path, options = {}) => request(path, { ...options, cookie, targetServer: isolatedServer });
}

const productInput = { name: 'Test product', price: 75, icon: 'P' };

test('product fat defaults to false and survives create, update, and state reload', async t => {
    const api = await productFixture(t);
    const initial = await api('/state');
    assert.equal(initial.response.status, 200);
    assert.ok(initial.data.products.length > 0);
    assert.ok(initial.data.products.every(product => product.fat === false));

    for (const fat of [undefined, false, true]) {
        const body = { ...productInput, ...(fat === undefined ? {} : { fat }) };
        const created = await api('/products', { method: 'POST', body });
        assert.equal(created.response.status, 201);
        assert.equal(created.data.fat, fat === true);
        const id = created.data.id;
        let state = await api('/state');
        assert.equal(state.data.products.find(product => product.id === id).fat, fat === true);

        const enabled = await api(`/products/${id}`, { method: 'PUT', body: { ...productInput, fat: true } });
        assert.equal(enabled.response.status, 200);
        assert.equal(enabled.data.fat, true);
        const omitted = await api(`/products/${id}`, { method: 'PUT', body: { ...productInput, name: 'Renamed product' } });
        assert.equal(omitted.response.status, 200);
        assert.equal(omitted.data.fat, true, 'omitting fat must preserve its stored value');
        state = await api('/state');
        assert.equal(state.data.products.find(product => product.id === id).fat, true);

        const disabled = await api(`/products/${id}`, { method: 'PUT', body: { ...productInput, fat: false } });
        assert.equal(disabled.response.status, 200);
        assert.equal(disabled.data.fat, false);
        const stillDisabled = await api(`/products/${id}`, { method: 'PUT', body: productInput });
        assert.equal(stillDisabled.response.status, 200);
        assert.equal(stillDisabled.data.fat, false);
        state = await api('/state');
        assert.equal(state.data.products.find(product => product.id === id).fat, false);
    }
});

test('product fat rejects non-boolean values without mutating state', async t => {
    const api = await productFixture(t);
    const created = await api('/products', { method: 'POST', body: { ...productInput, fat: true } });
    assert.equal(created.response.status, 201);
    const before = (await api('/state')).data;
    const backup = (await api('/admin/backup')).data;
    for (const fat of [null, 0, 1, -1, '', 'true', 'false', [], {}, [true]]) {
        await t.test(`reject ${JSON.stringify(fat)} on create, update, and restore`, async () => {
            const post = await api('/products', { method: 'POST', body: { ...productInput, fat } });
            assert.equal(post.response.status, 400);
            const put = await api(`/products/${created.data.id}`, { method: 'PUT', body: { ...productInput, fat } });
            assert.equal(put.response.status, 400);
            const restore = await api('/admin/restore', {
                method: 'POST',
                body: { ...backup, products: backup.products.map(product => ({ ...product, fat })) }
            });
            assert.equal(restore.response.status, 400);
            const after = (await api('/state')).data;
            assert.equal(after.revision, before.revision);
            assert.deepEqual(after.products, before.products);
        });
    }
});

test('member and fat are independent product flags', async t => {
    const api = await productFixture(t);
    for (const member of [false, true]) {
        for (const fat of [false, true]) {
            const created = await api('/products', { method: 'POST', body: { ...productInput, member, fat } });
            assert.equal(created.response.status, 201);
            assert.equal(created.data.member, member);
            assert.equal(created.data.fat, fat);
            const state = (await api('/state')).data;
            const stored = state.products.find(product => product.id === created.data.id);
            assert.equal(stored.member, member);
            assert.equal(stored.fat, fat);
            const updated = await api(`/products/${created.data.id}`, {
                method: 'PUT', body: { ...productInput, member: !member, fat: !fat }
            });
            assert.equal(updated.response.status, 200);
            assert.equal(updated.data.member, !member);
            assert.equal(updated.data.fat, !fat);
            const reloaded = (await api('/state')).data.products.find(product => product.id === created.data.id);
            assert.equal(reloaded.member, !member);
            assert.equal(reloaded.fat, !fat);
        }
    }
});

test('backup round-trip preserves fat and legacy backups default missing fat to false', async t => {
    const api = await productFixture(t);
    for (const fat of [false, true]) {
        const created = await api('/products', { method: 'POST', body: { ...productInput, member: true, fat } });
        assert.equal(created.response.status, 201);
    }
    const exported = await api('/admin/backup');
    assert.equal(exported.response.status, 200);
    assert.ok(exported.data.products.every(product => typeof product.fat === 'boolean'));
    assert.ok(exported.data.products.some(product => product.fat === true));
    assert.equal((await api('/admin/clear', { method: 'POST', body: {} })).response.status, 200);
    assert.equal((await api('/admin/restore', { method: 'POST', body: exported.data })).response.status, 200);
    assert.deepEqual((await api('/state')).data.products, exported.data.products);
    assert.deepEqual((await api('/admin/backup')).data.products, exported.data.products);

    const legacy = structuredClone(exported.data);
    legacy.products.forEach(product => { delete product.fat; });
    assert.equal((await api('/admin/restore', { method: 'POST', body: legacy })).response.status, 200);
    const expected = legacy.products.map(product => ({ ...product, fat: false }));
    assert.deepEqual((await api('/state')).data.products, expected);
    assert.deepEqual((await api('/admin/backup')).data.products, expected);
});

test('clearing data resets all default product fat flags to false', async t => {
    const api = await productFixture(t);
    const defaults = (await api('/state')).data.products;
    for (const product of defaults) {
        const changed = await api(`/products/${product.id}`, { method: 'PUT', body: { ...product, fat: true } });
        assert.equal(changed.response.status, 200);
    }
    assert.equal((await api('/products', { method: 'POST', body: { ...productInput, fat: true } })).response.status, 201);
    assert.equal((await api('/admin/clear', { method: 'POST', body: {} })).response.status, 200);
    const state = (await api('/state')).data;
    assert.deepEqual(state.products, defaults.map(product => ({ ...product, fat: false })));
    assert.ok(state.products.every(product => product.fat === false));
    assert.deepEqual((await api('/admin/backup')).data.products, state.products);
});

let adminCookie;
let staffCookie;

test('auth roles and atomic customer transactions', async t => {
    const admin = await createUser(db, { username: 'admin', password: 'test-password-admin', role: 'admin' });
    const staff = await createUser(db, { username: 'staff', password: 'test-password-staff' });

    await t.test('reject unauthenticated state and cross-origin writes', async () => {
        const denied = await request('/state');
        assert.equal(denied.response.status, 401);
        const rejected = await request('/customers', { method: 'POST', body: { name: 'Bad' }, origin: 'https://evil.example' });
        assert.equal(rejected.response.status, 403);
    });

    await t.test('login both roles and deny staff admin routes', async () => {
        const adminLogin = await request('/auth/login', { method: 'POST', body: { username: admin.username, password: 'test-password-admin' } });
        const staffLogin = await request('/auth/login', { method: 'POST', body: { username: staff.username, password: 'test-password-staff' } });
        assert.equal(adminLogin.response.status, 200);
        assert.equal(staffLogin.response.status, 200);
        adminCookie = adminLogin.response.headers.get('set-cookie').split(';')[0];
        staffCookie = staffLogin.response.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('/admin/users', { cookie: staffCookie })).response.status, 403);
        assert.equal((await request('/products', { method: 'POST', body: { name: 'Wine', price: 20, icon: '🍷' }, cookie: staffCookie })).response.status, 403);
    });

    await t.test('staff purchase, undo, settle, and sync state', async () => {
        const created = await request('/customers', { method: 'POST', body: { name: 'Testkunde' }, cookie: staffCookie });
        assert.equal(created.response.status, 201);
        const customerId = created.data.id;
        const purchase = await request('/transactions/purchase', { method: 'POST', body: { customerId, productId: 'beer' }, cookie: staffCookie });
        assert.equal(purchase.response.status, 201);
        let state = await request('/state', { cookie: staffCookie });
        assert.equal(state.data.customers.find(c => c.id === customerId).balance, 50);
        const undo = await request(`/transactions/undo/${customerId}`, { method: 'POST', body: {}, cookie: staffCookie });
        assert.equal(undo.response.status, 200);
        state = await request('/state', { cookie: staffCookie });
        assert.equal(state.data.customers.find(c => c.id === customerId).balance, 0);
        await request('/transactions/purchase', { method: 'POST', body: { customerId, productId: 'beer' }, cookie: staffCookie });
        const settled = await request(`/transactions/settle/${customerId}`, { method: 'POST', body: {}, cookie: staffCookie });
        assert.equal(settled.response.status, 201);
        state = await request('/state', { cookie: staffCookie });
        assert.equal(state.data.customers.find(c => c.id === customerId).balance, 0);
        assert.equal(state.data.transactions.filter(tx => tx.customerId === customerId).length, 2);
    });
});
