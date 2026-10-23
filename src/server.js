const http = require('node:http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const config = require('./config');
const { createMysqlStore } = require('./store/mysql-store');
const { createAuth } = require('./auth');
const { createPlayerService } = require('./player');
const { DomainError } = require('./domain');

async function createApp() {
  const store = createMysqlStore(config.db); await store.init();
  const auth = createAuth({ store, secret: config.jwtSecret });
  const players = createPlayerService({ store });
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: config.corsOrigin, credentials: true } });
  app.use(helmet()); app.use(cors({ origin: config.corsOrigin })); app.use(express.json({ limit: '256kb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'tu-tien-pixel-be', time: new Date().toISOString() }));
  app.post('/api/auth/register', async (req, res, next) => { try { res.status(201).json(await auth.register(req.body)); } catch (e) { next(e); } });
  app.post('/api/auth/login', async (req, res, next) => { try { res.json(await auth.login(req.body)); } catch (e) { next(e); } });
  app.use('/api/player', auth.authenticate);
  app.get('/api/player/me', (req, res, next) => { try { res.json({ player: players.snapshot(req.auth.sub) }); } catch (e) { next(e); } });
  app.post('/api/player', async (req, res, next) => { try { res.status(201).json({ player: await players.create(req.auth.sub, req.body) }); } catch (e) { next(e); } });
  app.get('/api/catalog/items', (_req, res) => res.json({ items: players.catalog }));
  app.post('/api/player/shop/buy', async (req, res, next) => { try { res.json({ player: await players.buy(req.auth.sub, String(req.body.requestId || ''), req.body.itemCode, req.body.quantity) }); } catch (e) { next(e); } });
  app.use((error, _req, res, _next) => { const e = error instanceof DomainError ? error : new DomainError('INTERNAL_ERROR', 'Lỗi máy chủ', 500); res.status(e.status).json({ ok: false, error: { code: e.code, message: e.message } }); });

  io.use((socket, next) => { try { socket.auth = require('jsonwebtoken').verify(socket.handshake.auth?.token || '', config.jwtSecret); next(); } catch { next(new Error('UNAUTHORIZED')); } });
  io.on('connection', (socket) => socket.on('game_command', async (envelope, ack) => {
    const safeAck = typeof ack === 'function' ? ack : () => {};
    const requestId = String(envelope?.requestId || '').trim(); const type = String(envelope?.type || '');
    if (!requestId || !['world.join', 'movement.intent', 'world.resync'].includes(type)) return safeAck({ ok: false, requestId, command: type, error: { code: 'INVALID_COMMAND', message: 'Command không được hỗ trợ' } });
    if (type === 'movement.intent' && (!Number.isFinite(Number(envelope.payload?.x)) || !Number.isFinite(Number(envelope.payload?.y)))) return safeAck({ ok: false, requestId, command: type, error: { code: 'INVALID_PAYLOAD', message: 'Tọa độ không hợp lệ' } });
    safeAck({ ok: true, requestId, command: type, serverTime: Date.now(), result: { accepted: true, userId: socket.auth.sub } });
  }));
  return { app, server, io };
}

if (require.main === module) createApp().then(({ server }) => server.listen(config.port, () => console.log(`Tu Tien Pixel BE listening on ${config.port}`)));
module.exports = { createApp };
