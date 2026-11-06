const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'bodenbar_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
    const [saltHex, keyHex] = String(encoded || '').split(':');
    if (!/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(keyHex || '')) return false;
    const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(actual, Buffer.from(keyHex, 'hex'));
}

function validateUsername(username) {
    const value = String(username || '').trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(value)) throw new Error('Brukernavn må være 3–32 tegn (bokstaver, tall, punktum, bindestrek eller understrek).');
    return value;
}

function validatePassword(password, minimum = 10) {
    if (typeof password !== 'string' || password.length < minimum || password.length > 200) {
        throw new Error(`Passordet må være minst ${minimum} tegn.`);
    }
    return password;
}

async function createUser(db, { username, password, role = 'staff' }) {
    const normalizedUsername = validateUsername(username);
    validatePassword(password);
    if (!['admin', 'staff'].includes(role)) throw new Error('Ugyldig rolle.');
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    db.prepare('INSERT INTO users (id, username, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
        .run(id, normalizedUsername, passwordHash, role, new Date().toISOString());
    return { id, username: normalizedUsername, role, active: true };
}

async function seedFirstAdmin(db, env = process.env) {
    const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    if (userCount > 0) return;
    if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
        throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD in .env before first startup; there is no default login.');
    }
    validatePassword(env.ADMIN_PASSWORD, 14);
    await createUser(db, { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, role: 'admin' });
    console.log('Created the initial BodenBar admin account from environment configuration.');
}

function getCookie(req, name) {
    const cookieHeader = req.headers.cookie || '';
    for (const part of cookieHeader.split(';')) {
        const [key, ...valueParts] = part.trim().split('=');
        if (key === name) return decodeURIComponent(valueParts.join('='));
    }
    return null;
}

function setSessionCookie(res, token, maxAgeSeconds = SESSION_DURATION_MS / 1000) {
    const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

function createSession(db, userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    const expiry = new Date(now.getTime() + SESSION_DURATION_MS);
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(hashToken(token), userId, now.toISOString(), expiry.toISOString());
    return token;
}

function requireAuth(db) {
    return (req, res, next) => {
        const token = getCookie(req, SESSION_COOKIE);
        if (!token) return res.status(401).json({ error: 'Logg inn for å fortsette.' });
        const row = db.prepare(`
            SELECT u.id, u.username, u.role, u.active, s.expires_at
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
        `).get(hashToken(token));
        if (!row || !row.active || row.expires_at <= new Date().toISOString()) {
            db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
            setSessionCookie(res, '', 0);
            return res.status(401).json({ error: 'Økten er utløpt. Logg inn igjen.' });
        }
        req.user = { id: row.id, username: row.username, role: row.role };
        next();
    };
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: 'Du har ikke tilgang til denne handlingen.' });
        next();
    };
}

module.exports = {
    SESSION_COOKIE, SESSION_DURATION_MS, hashPassword, verifyPassword, validateUsername, validatePassword,
    createUser, seedFirstAdmin, hashToken, getCookie, setSessionCookie, createSession, requireAuth, requireRole
};
