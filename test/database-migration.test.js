const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase, getState } = require('../server/database');

test('legacy products migrate fat with a constrained default and survive repeated reopen', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bodenbar-fat-migration-'));
    let db;
    t.after(() => {
        if (db?.open) db.close();
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const filename = path.join(directory, 'legacy.sqlite');
    db = new Database(filename);
    db.exec(`
        CREATE TABLE products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price INTEGER NOT NULL CHECK (price >= 0),
            icon TEXT NOT NULL,
            member INTEGER NOT NULL DEFAULT 0 CHECK (member IN (0, 1))
        );
        INSERT INTO products (id, name, price, icon, member) VALUES
            ('legacy-regular', 'Legacy regular', 75, 'R', 0),
            ('legacy-member', 'Legacy member', 0, 'M', 1);
    `);
    const legacyProducts = db.prepare('SELECT * FROM products ORDER BY rowid').all();
    db.close();

    db = openDatabase(filename);
    const fatColumns = db.pragma('table_info(products)').filter(column => column.name === 'fat');
    assert.equal(fatColumns.length, 1);
    assert.equal(fatColumns[0].type.toUpperCase(), 'INTEGER');
    assert.equal(fatColumns[0].notnull, 1);
    assert.equal(Number(fatColumns[0].dflt_value), 0);
    assert.deepEqual(db.prepare('SELECT * FROM products ORDER BY rowid').all(),
        legacyProducts.map(product => ({ ...product, fat: 0 })));
    const user = { id: 'test-admin', username: 'admin', role: 'admin' };
    assert.deepEqual(getState(db, user).products,
        legacyProducts.map(product => ({ ...product, member: Boolean(product.member), fat: false })));

    const insert = db.prepare('INSERT INTO products (id, name, price, icon, member) VALUES (?, ?, ?, ?, ?)');
    insert.run('new-default', 'Default flag', 10, 'D', 0);
    assert.equal(db.prepare('SELECT fat FROM products WHERE id = ?').get('new-default').fat, 0);
    for (const fat of [null, -1, 2]) {
        assert.throws(() => db.prepare('UPDATE products SET fat = ? WHERE id = ?').run(fat, 'legacy-regular'),
            error => error.code.startsWith('SQLITE_CONSTRAINT'));
    }
    db.prepare('UPDATE products SET fat = 1 WHERE id = ?').run('legacy-member');
    const expectedRows = db.prepare('SELECT * FROM products ORDER BY rowid').all();
    const expectedState = getState(db, user).products;
    const expectedRevision = getState(db, user).revision;

    for (let reopen = 0; reopen < 2; reopen++) {
        db.close();
        db = openDatabase(filename);
        assert.equal(db.pragma('table_info(products)').filter(column => column.name === 'fat').length, 1);
        assert.deepEqual(db.prepare('SELECT * FROM products ORDER BY rowid').all(), expectedRows);
        assert.deepEqual(getState(db, user).products, expectedState);
        assert.equal(getState(db, user).revision, expectedRevision);
        assert.equal(getState(db, user).products.find(product => product.id === 'legacy-member').fat, true);
        assert.equal(getState(db, user).products.find(product => product.id === 'legacy-regular').fat, false);
        assert.throws(() => db.prepare('UPDATE products SET fat = 2 WHERE id = ?').run('legacy-member'),
            error => error.code === 'SQLITE_CONSTRAINT_CHECK');
    }
});
