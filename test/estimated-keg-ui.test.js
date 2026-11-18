const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('estimated keg storage saves and resets through admin API and reloads authoritative state', async t => {
    const { storage } = await import(moduleUrl(fs.readFileSync(path.join(__dirname, '../js/modules/storage.js'), 'utf8')));
    assert.equal(storage.getEstimatedKeg().enabled, false);
    const previous = global.fetch;
    t.after(() => { global.fetch = previous; });
    const keg = { id: 'helles-lager', enabled: true, capacityMl: 30000, remainingMl: 29500, rawRemainingMl: 29500, cycleId: 'one', productIds: ['helles'], servingMl: 500 };
    const payload = { enabled: true, capacityLitres: 30, productIds: ['helles'] };
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        const data = url === '/api/state' ? { revision: 2, estimatedKeg: keg, transactions: [{ id: 'purchase', consumption: { cycleId: 'one', ml: 500 } }] } : keg;
        return { ok: true, status: 200, json: async () => data };
    };
    await storage.saveEstimatedKeg(payload);
    assert.equal(calls[0].url, '/api/admin/estimated-keg');
    assert.equal(calls[0].options.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].options.body), payload);
    assert.equal(calls[1].url, '/api/state');
    assert.deepEqual(storage.getEstimatedKeg(), keg);
    await storage.resetEstimatedKeg();
    assert.equal(calls[2].url, '/api/admin/estimated-keg/reset');
    assert.equal(calls[2].options.method, 'POST');
    assert.equal(calls[3].url, '/api/state');
    const backup = storage.exportAllData();
    assert.equal(backup.version, 3);
    assert.deepEqual(backup.estimatedKeg, keg);
    assert.deepEqual(backup.transactions[0].consumption, { cycleId: 'one', ml: 500 });
    global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Ugyldig volum' }) });
    await assert.rejects(storage.saveEstimatedKeg(payload), /Ugyldig volum/);
    assert.equal(storage.getEstimatedKeg().remainingMl, 29500, 'failed save must not mutate cached volume');
});
