const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DEFAULT_PRODUCTS = [
    { id: 'beer', name: 'Øl', price: 50, icon: '🍺', member: false },
    { id: 'whisky', name: 'Whisky', price: 100, icon: '🥃', member: false },
    { id: 'fegisbubbler', name: 'Fegisbubbler', price: 25, icon: '🫧', member: false },
    { id: 'beer-member', name: 'Øl til bryggerimedlem', price: 0, icon: '🍺', member: true },
    { id: 'whisky-member', name: 'Whisky til bryggerimedlem', price: 0, icon: '🥃', member: true }
];

const DEFAULT_SETTINGS = { vippsNumber: '1234567890', theme: 'dark' };

function openDatabase(filename = process.env.DATABASE_PATH || './data/bodenbar.sqlite') {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    const db = new Database(filename);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
            active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
        CREATE TABLE IF NOT EXISTS customers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            balance INTEGER NOT NULL DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            price INTEGER NOT NULL CHECK (price >= 0),
            icon TEXT NOT NULL,
            member INTEGER NOT NULL DEFAULT 0 CHECK (member IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS transactions (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK (type IN ('purchase', 'payment', 'correction')),
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            amount INTEGER NOT NULL,
            price INTEGER NOT NULL,
            timestamp TEXT NOT NULL,
            corrected INTEGER NOT NULL DEFAULT 0 CHECK (corrected IN (0, 1)),
            corrected_at TEXT
        );
        CREATE INDEX IF NOT EXISTS transactions_customer_sequence ON transactions(customer_id, sequence DESC);
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    const seed = db.transaction(() => {
        const productCount = db.prepare('SELECT COUNT(*) AS count FROM products').get().count;
        if (productCount === 0) {
            const insert = db.prepare('INSERT INTO products (id, name, price, icon, member) VALUES (?, ?, ?, ?, ?)');
            DEFAULT_PRODUCTS.forEach(product => insert.run(product.id, product.name, product.price, product.icon, Number(product.member)));
        }
        const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
        Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => insertSetting.run(key, JSON.stringify(value)));
        db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES ('revision', '1')").run();
    });
    seed();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
    return db;
}

function bumpRevision(db) {
    db.prepare("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'").run();
    return Number(db.prepare("SELECT value FROM metadata WHERE key = 'revision'").get().value);
}

function getRevision(db) {
    return Number(db.prepare("SELECT value FROM metadata WHERE key = 'revision'").get().value);
}

function currentDay(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: process.env.TZ || 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
}

function localDay(isoDate) {
    return currentDay(new Date(isoDate));
}

function getSettings(db) {
    const settings = { ...DEFAULT_SETTINGS };
    db.prepare('SELECT key, value FROM settings').all().forEach(row => {
        try { settings[row.key] = JSON.parse(row.value); } catch { /* Ignore malformed legacy setting rows. */ }
    });
    return settings;
}

function getState(db, user) {
    const customers = db.prepare('SELECT * FROM customers ORDER BY created_at, id').all().map(row => ({
        id: row.id, name: row.name, balance: row.balance, archived: Boolean(row.archived),
        createdAt: row.created_at, updatedAt: row.updated_at
    }));
    const transactions = db.prepare('SELECT * FROM transactions ORDER BY sequence').all().map(row => ({
        id: row.id, customerId: row.customer_id, type: row.type, productId: row.product_id,
        productName: row.product_name, amount: row.amount, price: row.price, timestamp: row.timestamp,
        ...(row.corrected ? { corrected: true, correctedAt: row.corrected_at } : {})
    }));
    const products = db.prepare('SELECT id, name, price, icon, member FROM products ORDER BY rowid').all().map(row => ({ ...row, member: Boolean(row.member) }));
    const today = currentDay();
    const todayTransactions = transactions.filter(transaction => localDay(transaction.timestamp) === today);
    const stats = { date: today, revenue: 0, paid: 0, outstanding: 0, transactionCount: todayTransactions.length, activeCustomers: 0 };
    todayTransactions.forEach(transaction => {
        if (transaction.type === 'purchase' || transaction.type === 'correction') stats.revenue += transaction.amount;
        if (transaction.type === 'payment') stats.paid += transaction.amount;
    });
    const paidCustomerIds = new Set(transactions.filter(transaction => transaction.type === 'payment').map(transaction => transaction.customerId));
    customers.forEach(customer => {
        if (!customer.archived && customer.balance > 0) stats.outstanding += customer.balance;
        if (!customer.archived && (customer.balance !== 0 || !paidCustomerIds.has(customer.id))) stats.activeCustomers++;
    });
    return { revision: getRevision(db), user: { id: user.id, username: user.username, role: user.role }, customers, transactions, products, settings: getSettings(db), dailyStats: stats };
}

module.exports = { DEFAULT_PRODUCTS, DEFAULT_SETTINGS, openDatabase, bumpRevision, getRevision, getSettings, getState };
