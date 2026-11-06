const express = require('express');
const crypto = require('node:crypto');
const {
    DEFAULT_PRODUCTS, DEFAULT_SETTINGS, bumpRevision, getRevision, getSettings, getState
} = require('./database');
const {
    SESSION_COOKIE, verifyPassword, validateUsername, validatePassword, createUser,
    hashPassword, hashToken, getCookie, setSessionCookie, createSession, requireAuth, requireRole
} = require('./auth');

function badRequest(message) {
    const error = new Error(message);
    error.status = 400;
    throw error;
}

function requireText(value, label, maxLength = 120) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) badRequest(`${label} er ugyldig.`);
    return value.trim();
}

function requireAmount(value, label = 'Beløpet') {
    if (!Number.isSafeInteger(value) || value < 0) badRequest(`${label} må være et heltall på 0 eller mer.`);
    return value;
}

function validateProduct(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) badRequest('Produktdata er ugyldig.');
    const id = requireText(input.id, 'Produkt-ID', 64);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) badRequest('Produkt-ID er ugyldig.');
    const name = requireText(input.name, 'Produktnavn', 60);
    const icon = requireText(input.icon, 'Produktikon', 8);
    const price = requireAmount(input.price, 'Prisen');
    if (input.member !== undefined && typeof input.member !== 'boolean') badRequest('Medlemsvalget er ugyldig.');
    return { id, name, icon, price, member: input.member === true };
}

function serializeSettings(db) {
    return getSettings(db);
}

function makeApi(db) {
    const router = express.Router();
    const auth = requireAuth(db);
    const adminOnly = [auth, requireRole('admin')];
    const staffOrAdmin = [auth, requireRole('admin', 'staff')];
    const changingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const loginAttempts = new Map();
    const loginWindowMs = 15 * 60 * 1000;
    const maxLoginAttempts = 10;

    router.use((req, res, next) => {
        if (!changingMethods.has(req.method)) return next();
        const origin = req.get('origin');
        const host = req.get('host');
        const expected = `${req.protocol}://${host}`;
        if (!origin || origin !== expected) return res.status(403).json({ error: 'Ugyldig forespørselsopprinnelse.' });
        next();
    });

    router.get('/health', (_req, res) => res.json({ ok: true }));

    router.get('/auth/session', (req, res) => {
        const token = getCookie(req, SESSION_COOKIE);
        if (!token) return res.json({ user: null });
        const row = db.prepare(`
            SELECT u.id, u.username, u.role, u.active, s.expires_at
            FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?
        `).get(hashToken(token));
        if (!row || !row.active || row.expires_at <= new Date().toISOString()) {
            db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
            setSessionCookie(res, '', 0);
            return res.json({ user: null });
        }
        res.json({ user: { id: row.id, username: row.username, role: row.role } });
    });

    router.post('/auth/login', async (req, res, next) => {
        const now = Date.now();
        const client = req.ip || req.socket.remoteAddress || 'unknown';
        const attempt = loginAttempts.get(client);
        if (attempt && now - attempt.startedAt < loginWindowMs && attempt.count >= maxLoginAttempts) {
            return res.status(429).json({ error: 'For mange påloggingsforsøk. Prøv igjen senere.' });
        }
        if (attempt && now - attempt.startedAt >= loginWindowMs) loginAttempts.delete(client);
        try {
            const username = requireText(req.body?.username, 'Brukernavn', 32);
            const password = typeof req.body?.password === 'string' ? req.body.password : '';
            const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
            if (!user || !user.active || !(await verifyPassword(password, user.password_hash))) {
                const current = loginAttempts.get(client);
                if (!current || now - current.startedAt >= loginWindowMs) loginAttempts.set(client, { startedAt: now, count: 1 });
                else current.count += 1;
                return res.status(401).json({ error: 'Feil brukernavn eller passord.' });
            }
            loginAttempts.delete(client);
            const token = createSession(db, user.id);
            setSessionCookie(res, token);
            res.json({ user: { id: user.id, username: user.username, role: user.role } });
        } catch (error) { next(error); }
    });

    router.post('/auth/logout', (req, res) => {
        const token = getCookie(req, SESSION_COOKIE);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
        setSessionCookie(res, '', 0);
        res.json({ ok: true });
    });

    router.post('/auth/password', auth, async (req, res, next) => {
        try {
            const oldPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
            const newPassword = validatePassword(req.body?.newPassword);
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
            if (!(await verifyPassword(oldPassword, user.password_hash))) return res.status(400).json({ error: 'Nåværende passord er feil.' });
            const passwordHash = await hashPassword(newPassword);
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.user.id);
            db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.user.id);
            setSessionCookie(res, '', 0);
            res.json({ ok: true });
        } catch (error) { next(error); }
    });

    router.get('/state', auth, (req, res) => {
        const since = Number(req.query.since);
        const revision = getRevision(db);
        if (Number.isSafeInteger(since) && since === revision) return res.json({ revision, unchanged: true });
        res.json(getState(db, req.user));
    });

    router.post('/customers', ...staffOrAdmin, (req, res) => {
        const name = requireText(req.body?.name, 'Kundenavn', 120);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare('INSERT INTO customers (id, name, balance, archived, created_at, updated_at) VALUES (?, ?, 0, 0, ?, ?)').run(id, name, now, now);
        bumpRevision(db);
        res.status(201).json({ id, name, balance: 0, archived: false, createdAt: now, updatedAt: now });
    });

    router.patch('/customers/:id', ...staffOrAdmin, (req, res) => {
        const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
        if (!customer) return res.status(404).json({ error: 'Kunde ikke funnet.' });
        const name = req.body?.name === undefined ? customer.name : requireText(req.body.name, 'Kundenavn', 120);
        const archived = req.body?.archived === undefined ? Boolean(customer.archived) : req.body.archived;
        if (typeof archived !== 'boolean') badRequest('Arkivstatus er ugyldig.');
        const updatedAt = new Date().toISOString();
        db.prepare('UPDATE customers SET name = ?, archived = ?, updated_at = ? WHERE id = ?').run(name, Number(archived), updatedAt, customer.id);
        bumpRevision(db);
        res.json({ id: customer.id, name, balance: customer.balance, archived, createdAt: customer.created_at, updatedAt });
    });

    router.delete('/customers/:id', ...adminOnly, (req, res) => {
        const result = db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
        if (!result.changes) return res.status(404).json({ error: 'Kunde ikke funnet.' });
        bumpRevision(db);
        res.json({ ok: true });
    });

    router.post('/transactions/purchase', ...staffOrAdmin, (req, res) => {
        const customerId = requireText(req.body?.customerId, 'Kunde', 64);
        const productId = requireText(req.body?.productId, 'Produkt', 64);
        const execute = db.transaction(() => {
            const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
            if (!customer || customer.archived) badRequest('Kunden finnes ikke eller er arkivert.');
            if (!product) badRequest('Produktet finnes ikke lenger.');
            const transaction = {
                id: crypto.randomUUID(), customerId, type: 'purchase', productId,
                productName: product.name, amount: product.price, price: product.price, timestamp: new Date().toISOString()
            };
            db.prepare(`INSERT INTO transactions (id, customer_id, type, product_id, product_name, amount, price, timestamp)
                VALUES (@id, @customerId, @type, @productId, @productName, @amount, @price, @timestamp)`).run(transaction);
            db.prepare('UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?').run(product.price, transaction.timestamp, customerId);
            return transaction;
        });
        const transaction = execute();
        bumpRevision(db);
        res.status(201).json(transaction);
    });

    router.post('/transactions/settle/:customerId', ...staffOrAdmin, (req, res) => {
        const execute = db.transaction(() => {
            const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.customerId);
            if (!customer) badRequest('Kunde ikke funnet.');
            if (customer.balance === 0) badRequest('Kunden har ingen saldo å gjøre opp.');
            const isPayment = customer.balance > 0;
            const transaction = {
                id: crypto.randomUUID(), customerId: customer.id, type: isPayment ? 'payment' : 'correction',
                productId: isPayment ? 'payment' : 'credit', productName: isPayment ? 'Betaling' : 'Gjenopptak',
                amount: Math.abs(customer.balance), price: Math.abs(customer.balance), timestamp: new Date().toISOString()
            };
            db.prepare(`INSERT INTO transactions (id, customer_id, type, product_id, product_name, amount, price, timestamp)
                VALUES (@id, @customerId, @type, @productId, @productName, @amount, @price, @timestamp)`).run(transaction);
            db.prepare('UPDATE customers SET balance = 0, updated_at = ? WHERE id = ?').run(transaction.timestamp, customer.id);
            return transaction;
        });
        const transaction = execute();
        bumpRevision(db);
        res.status(201).json(transaction);
    });

    router.post('/transactions/undo/:customerId', ...staffOrAdmin, (req, res) => {
        const execute = db.transaction(() => {
            const last = db.prepare('SELECT * FROM transactions WHERE customer_id = ? ORDER BY sequence DESC LIMIT 1').get(req.params.customerId);
            if (!last || last.type !== 'purchase') return null;
            db.prepare('DELETE FROM transactions WHERE id = ?').run(last.id);
            db.prepare('UPDATE customers SET balance = balance - ?, updated_at = ? WHERE id = ?').run(last.amount, new Date().toISOString(), last.customer_id);
            return { id: last.id, productName: last.product_name, amount: last.amount };
        });
        const removed = execute();
        if (!removed) return res.status(404).json({ error: 'Ingen kjøp å angre.' });
        bumpRevision(db);
        res.json(removed);
    });

    router.post('/transactions/:id/correct', ...staffOrAdmin, (req, res) => {
        const productId = requireText(req.body?.productId, 'Produkt', 64);
        const amount = requireAmount(req.body?.amount);
        const execute = db.transaction(() => {
            const transaction = db.prepare("SELECT * FROM transactions WHERE id = ? AND type = 'purchase'").get(req.params.id);
            if (!transaction) badRequest('Kjøpet finnes ikke lenger.');
            const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
            if (!product) badRequest('Produktet finnes ikke lenger.');
            const difference = amount - transaction.amount;
            const now = new Date().toISOString();
            db.prepare('UPDATE transactions SET product_id = ?, product_name = ?, amount = ?, price = ?, corrected = 1, corrected_at = ? WHERE id = ?')
                .run(productId, product.name, amount, amount, now, transaction.id);
            db.prepare('UPDATE customers SET balance = balance + ?, updated_at = ? WHERE id = ?').run(difference, now, transaction.customer_id);
            return { id: transaction.id, productId, productName: product.name, amount, price: amount, corrected: true, correctedAt: now };
        });
        const corrected = execute();
        bumpRevision(db);
        res.json(corrected);
    });

    router.post('/products', ...adminOnly, (req, res) => {
        const product = validateProduct({ ...req.body, id: crypto.randomUUID() });
        db.prepare('INSERT INTO products (id, name, price, icon, member) VALUES (?, ?, ?, ?, ?)')
            .run(product.id, product.name, product.price, product.icon, Number(product.member));
        bumpRevision(db);
        res.status(201).json(product);
    });

    router.put('/products/:id', ...adminOnly, (req, res) => {
        const product = validateProduct({ ...req.body, id: req.params.id });
        const result = db.prepare('UPDATE products SET name = ?, price = ?, icon = ?, member = ? WHERE id = ?')
            .run(product.name, product.price, product.icon, Number(product.member), product.id);
        if (!result.changes) return res.status(404).json({ error: 'Produktet finnes ikke.' });
        bumpRevision(db);
        res.json(product);
    });

    router.delete('/products/:id', ...adminOnly, (req, res) => {
        if (db.prepare('SELECT 1 FROM transactions WHERE product_id = ? LIMIT 1').get(req.params.id)) {
            return res.status(409).json({ error: 'Produktet er brukt i historikken og kan ikke fjernes.' });
        }
        const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        if (!result.changes) return res.status(404).json({ error: 'Produktet finnes ikke.' });
        bumpRevision(db);
        res.json({ ok: true });
    });

    router.put('/settings', ...adminOnly, (req, res) => {
        const vippsNumber = typeof req.body?.vippsNumber === 'string' ? req.body.vippsNumber.trim().slice(0, 40) : '';
        const theme = req.body?.theme === 'light' ? 'light' : 'dark';
        const update = db.transaction(() => {
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('vippsNumber', JSON.stringify(vippsNumber));
            db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('theme', JSON.stringify(theme));
        });
        update();
        bumpRevision(db);
        res.json(serializeSettings(db));
    });

    router.get('/admin/users', ...adminOnly, (_req, res) => {
        const users = db.prepare('SELECT id, username, role, active, created_at FROM users ORDER BY role, username').all()
            .map(user => ({ id: user.id, username: user.username, role: user.role, active: Boolean(user.active), createdAt: user.created_at }));
        res.json(users);
    });

    router.post('/admin/users', ...adminOnly, async (req, res, next) => {
        try {
            const user = await createUser(db, { username: req.body?.username, password: req.body?.password, role: 'staff' });
            bumpRevision(db);
            res.status(201).json(user);
        } catch (error) {
            error.status ||= error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400;
            next(error);
        }
    });

    router.patch('/admin/users/:id', ...adminOnly, async (req, res, next) => {
        try {
            const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
            if (!user) return res.status(404).json({ error: 'Brukeren finnes ikke.' });
            if (user.role !== 'staff') return res.status(400).json({ error: 'Admin-kontoer kan ikke endres her.' });
            if (typeof req.body?.active === 'boolean') {
                db.prepare('UPDATE users SET active = ? WHERE id = ?').run(Number(req.body.active), user.id);
                if (!req.body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
            }
            if (req.body?.password !== undefined) {
                validatePassword(req.body.password);
                db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(req.body.password), user.id);
                db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
            }
            bumpRevision(db);
            const updated = db.prepare('SELECT id, username, role, active, created_at FROM users WHERE id = ?').get(user.id);
            res.json({ id: updated.id, username: updated.username, role: updated.role, active: Boolean(updated.active), createdAt: updated.created_at });
        } catch (error) { error.status ||= 400; next(error); }
    });

    router.get('/admin/backup', ...adminOnly, (req, res) => {
        const data = getState(db, req.user);
        res.json({ version: 2, exportDate: new Date().toISOString(), customers: data.customers, transactions: data.transactions, products: data.products, settings: data.settings });
    });

    router.post('/admin/restore', ...adminOnly, (req, res) => {
        const backup = req.body;
        if (!backup || backup.version !== 2 || !Array.isArray(backup.customers) || !Array.isArray(backup.transactions) || !Array.isArray(backup.products) || !backup.settings || typeof backup.settings !== 'object') {
            badRequest('Ugyldig BodenBar-sikkerhetskopi (forventet versjon 2).');
        }
        const customers = backup.customers.map(item => {
            if (!item || typeof item !== 'object') badRequest('Kundedata i sikkerhetskopien er ugyldige.');
            return {
                id: requireText(item.id, 'Kunde-ID', 64), name: requireText(item.name, 'Kundenavn', 120),
                balance: Number.isSafeInteger(item.balance) ? item.balance : badRequest('Kundesaldo i sikkerhetskopien er ugyldig.'),
                archived: Boolean(item.archived), createdAt: requireText(item.createdAt, 'Opprettelsesdato', 40),
                updatedAt: requireText(item.updatedAt, 'Endringsdato', 40)
            };
        });
        const customerIds = new Set(customers.map(customer => customer.id));
        if (customerIds.size !== customers.length) badRequest('Sikkerhetskopien inneholder dupliserte kunder.');
        const products = backup.products.map(validateProduct);
        if (new Set(products.map(product => product.id)).size !== products.length) badRequest('Sikkerhetskopien inneholder dupliserte produkter.');
        const transactions = backup.transactions.map(item => {
            if (!item || typeof item !== 'object' || !customerIds.has(item.customerId)) badRequest('Transaksjonsdata i sikkerhetskopien er ugyldige.');
            if (!['purchase', 'payment', 'correction'].includes(item.type) || !Number.isSafeInteger(item.amount)) badRequest('Transaksjonsdata i sikkerhetskopien er ugyldige.');
            return {
                id: requireText(item.id, 'Transaksjons-ID', 64), customerId: item.customerId, type: item.type,
                productId: requireText(item.productId, 'Produkt-ID', 64), productName: requireText(item.productName, 'Produktnavn', 120),
                amount: item.amount, price: Number.isSafeInteger(item.price) ? item.price : item.amount,
                timestamp: requireText(item.timestamp, 'Transaksjonstid', 40), corrected: Boolean(item.corrected), correctedAt: item.correctedAt || null
            };
        });
        const transactionIds = new Set(transactions.map(transaction => transaction.id));
        if (transactionIds.size !== transactions.length) badRequest('Sikkerhetskopien inneholder dupliserte transaksjoner.');
        const settings = {
            vippsNumber: typeof backup.settings.vippsNumber === 'string' ? backup.settings.vippsNumber.slice(0, 40) : '',
            theme: backup.settings.theme === 'light' ? 'light' : 'dark'
        };
        const restore = db.transaction(() => {
            db.prepare('DELETE FROM customers').run();
            db.prepare('DELETE FROM products').run();
            const addCustomer = db.prepare('INSERT INTO customers (id, name, balance, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
            customers.forEach(customer => addCustomer.run(customer.id, customer.name, customer.balance, Number(customer.archived), customer.createdAt, customer.updatedAt));
            const addProduct = db.prepare('INSERT INTO products (id, name, price, icon, member) VALUES (?, ?, ?, ?, ?)');
            products.forEach(product => addProduct.run(product.id, product.name, product.price, product.icon, Number(product.member)));
            const addTransaction = db.prepare(`INSERT INTO transactions (id, customer_id, type, product_id, product_name, amount, price, timestamp, corrected, corrected_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            transactions.forEach(transaction => addTransaction.run(transaction.id, transaction.customerId, transaction.type, transaction.productId, transaction.productName, transaction.amount, transaction.price, transaction.timestamp, Number(transaction.corrected), transaction.correctedAt));
            db.prepare('DELETE FROM settings').run();
            Object.entries(settings).forEach(([key, value]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value)));
        });
        restore();
        bumpRevision(db);
        res.json({ ok: true });
    });

    router.post('/admin/clear', ...adminOnly, (req, res) => {
        const clear = db.transaction(() => {
            db.prepare('DELETE FROM customers').run();
            db.prepare('DELETE FROM products').run();
            const insert = db.prepare('INSERT INTO products (id, name, price, icon, member) VALUES (?, ?, ?, ?, ?)');
            DEFAULT_PRODUCTS.forEach(product => insert.run(product.id, product.name, product.price, product.icon, Number(product.member)));
            db.prepare('DELETE FROM settings').run();
            Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value)));
        });
        clear();
        bumpRevision(db);
        res.json({ ok: true });
    });

    return router;
}

module.exports = { makeApi };
