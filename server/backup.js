const fs = require('node:fs');
const path = require('node:path');
const { getState, openDatabase, bumpRevision } = require('./database');
const { getSettings } = require('./database');

const BACKUP_DIR = path.resolve(__dirname, '..', 'data', 'backups');
const BACKUP_RETENTION_DAYS = 90; // Keep backups for 90 days

function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

function getBackupFilename(date = new Date()) {
    // Use business day for filename consistency
    const timeZone = process.env.TZ || 'Europe/Oslo';
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const hour = Number(fields.hour);
    let day = date;
    if (hour < 4) {
        day = new Date(date.getTime() - 24 * 60 * 60 * 1000);
        const prevParts = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(day);
        const prevFields = Object.fromEntries(prevParts.map(part => [part.type, part.value]));
        return `bodenbar-backup-${prevFields.year}-${prevFields.month}-${prevFields.day}.json`;
    }
    return `bodenbar-backup-${fields.year}-${fields.month}-${fields.day}.json`;
}

function createBackup(db) {
    ensureBackupDir();

    // Get a temporary user object for getState (admin-like access to all data)
    const tempUser = { id: 'backup', username: 'backup', role: 'admin' };
    const state = getState(db, tempUser);

    const backup = {
        version: 3,
        backupDate: new Date().toISOString(),
        businessDay: getBackupFilename().replace('bodenbar-backup-', '').replace('.json', ''),
        estimatedKeg: state.estimatedKeg,
        customers: state.customers,
        transactions: state.transactions,
        products: state.products,
        settings: state.settings
    };

    const filename = getBackupFilename();
    const filepath = path.join(BACKUP_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`[Backup] Created: ${filename}`);

    // Clean up old backups
    cleanupOldBackups();

    return { filename, filepath, businessDay: backup.businessDay };
}

function cleanupOldBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('bodenbar-backup-') && f.endsWith('.json'))
        .map(f => {
            const match = f.match(/bodenbar-backup-(\d{4})-(\d{2})-(\d{2})\.json/);
            if (!match) return null;
            const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
            return { filename: f, date: date.getTime() };
        })
        .filter(Boolean)
        .sort((a, b) => b.date - a.date); // Newest first

    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    files.forEach(file => {
        if (file.date < cutoff) {
            const filepath = path.join(BACKUP_DIR, file.filename);
            fs.unlinkSync(filepath);
            console.log(`[Backup] Deleted old backup: ${file.filename}`);
        }
    });
}

function scheduleDailyBackup(db) {
    // Calculate milliseconds until next 04:00 in Oslo timezone
    function msUntilNextBusinessDay() {
        const now = new Date();
        const timeZone = process.env.TZ || 'Europe/Oslo';

        // Get current time in Oslo
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(now);
        const fields = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));

        // Create next 04:00 in Oslo time
        const nextBusinessDay = new Date();
        nextBusinessDay.setHours(4, 0, 0, 0); // This sets local time, but we need Oslo time

        // Better approach: calculate using UTC
        const nowUtc = now.getTime();
        // Get current Oslo hour
        const osloHour = fields.hour;

        let targetDate = new Date(now);
        if (osloHour >= 4) {
            // Next business day starts tomorrow at 04:00
            targetDate.setDate(targetDate.getDate() + 1);
        }
        // Set to 04:00 Oslo time
        // We need to convert 04:00 Oslo to UTC
        const targetParts = new Intl.DateTimeFormat('en-CA', {
            timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(targetDate);
        const targetFields = Object.fromEntries(targetParts.map(part => [part.type, part.value]));
        const targetOslo = `${targetFields.year}-${targetFields.month}-${targetFields.day}T04:00:00.000`;
        // Parse as Oslo time by constructing ISO with timezone
        const targetUtc = new Date(targetOslo + (timeZone === 'Europe/Oslo' ? '' : '')).getTime(); // This is tricky

        // Simpler: use the fact that we know the offset
        // Get current UTC offset for Oslo
        const offsetMs = new Date(now.toLocaleString('en-US', { timeZone })).getTime() - now.getTime();
        const targetLocal = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 4, 0, 0);
        const targetUtcMs = targetLocal.getTime() - offsetMs;

        const ms = targetUtcMs - nowUtc;
        return Math.max(ms, 1000); // At least 1 second
    }

    function runBackup() {
        try {
            createBackup(db);
        } catch (error) {
            console.error('[Backup] Failed:', error.message);
        }
        // Schedule next
        const ms = msUntilNextBusinessDay();
        setTimeout(runBackup, ms);
    }

    // Initial run
    const initialMs = msUntilNextBusinessDay();
    console.log(`[Backup] Next scheduled in ${Math.round(initialMs / 60000)} minutes`);
    setTimeout(runBackup, initialMs);
}

function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];

    return fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('bodenbar-backup-') && f.endsWith('.json'))
        .map(f => {
            const match = f.match(/bodenbar-backup-(\d{4})-(\d{2})-(\d{2})\.json/);
            if (!match) return null;
            const filepath = path.join(BACKUP_DIR, f);
            const stats = fs.statSync(filepath);
            return {
                filename: f,
                businessDay: `${match[1]}-${match[2]}-${match[3]}`,
                size: stats.size,
                createdAt: stats.birthtime.toISOString()
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.businessDay.localeCompare(a.businessDay));
}

function readBackup(filename) {
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) return null;
    const content = fs.readFileSync(filepath, 'utf8');
    return JSON.parse(content);
}

module.exports = {
    createBackup,
    scheduleDailyBackup,
    listBackups,
    readBackup,
    BACKUP_DIR,
    getBackupFilename
};