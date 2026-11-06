const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./database');
const { seedFirstAdmin } = require('./auth');
const { makeApi } = require('./api');

async function start() {
    const db = openDatabase();
    await seedFirstAdmin(db);
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '10mb' }));
    app.use('/api', makeApi(db));
    app.use((req, res, next) => {
        if (/^\/(?:server|node_modules|data|test)(?:\/|$)/.test(req.path) || /^\/(?:package(?:-lock)?\.json|Dockerfile|compose\.yaml|\.env)/.test(req.path)) {
            return res.sendStatus(404);
        }
        next();
    });
    app.use(express.static(path.resolve(__dirname, '..'), { index: 'index.html', dotfiles: 'deny' }));
    app.use((error, _req, res, _next) => {
        if (res.headersSent) return;
        const status = Number.isInteger(error.status) ? error.status : (error.type === 'entity.too.large' ? 413 : 500);
        if (status >= 500) console.error(error);
        res.status(status).json({ error: status === 413 ? 'Filen er for stor.' : (status >= 500 ? 'En intern feil oppstod.' : error.message) });
    });
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '0.0.0.0';
    const server = app.listen(port, host, () => console.log(`BodenBar listening on ${host}:${port}`));
    const shutdown = () => server.close(() => { db.close(); process.exit(0); });
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}

if (require.main === module) {
    start().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { start };
