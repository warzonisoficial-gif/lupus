import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { ClassId } from '../shared/types';
import { GameRoom } from './GameRoom';

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const MAIN_ROOM_ID = 'vilarejo_principal';
const mainRoom = new GameRoom(MAIN_ROOM_ID, io);

io.on('connection', (socket) => {
  const playerName =
    (socket.handshake.query.name as string) || `Morador_${socket.id.slice(0, 4)}`;
  const initialXp = Number(socket.handshake.query.xp) || 15000;

  mainRoom.addPlayer(socket.id, playerName, false, initialXp);
  socket.join(MAIN_ROOM_ID);

  socket.emit('snapshot', mainRoom.getSnapshotForPlayer(socket.id));

  socket.on('select_class', (classId: ClassId, cb?: (res: { ok: boolean; reason?: string }) => void) => {
    const res = mainRoom.selectClass(socket.id, classId);
    if (cb) cb(res);
  });

  socket.on('start_match', (botCount = 9) => {
    mainRoom.startMatchWithBots(botCount);
  });

  socket.on(
    'move',
    (payload: { dx: number; dy: number; angle: number; x?: number; y?: number }) => {
      mainRoom.handleMove(
        socket.id,
        payload.dx,
        payload.dy,
        payload.angle,
        payload.x,
        payload.y
      );
    }
  );

  socket.on('mission_interact', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const res = mainRoom.handleMissionInteract(socket.id);
    if (cb) cb(res);
  });

  socket.on('use_ability', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const res = mainRoom.handleUseAbility(socket.id);
    if (cb) cb(res);
  });

  socket.on('werewolf_transform', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const res = mainRoom.handleWerewolfTransform(socket.id);
    if (cb) cb(res);
  });

  socket.on('report_or_bell', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const res = mainRoom.handleReportOrBell(socket.id);
    if (cb) cb(res);
  });

  socket.on('toggle_barrel', (cb?: (res: any) => void) => {
    const res = mainRoom.handleToggleBarrel(socket.id);
    if (cb) cb(res);
  });

  socket.on('toggle_tomb', (cb?: (res: any) => void) => {
    const res = mainRoom.handleToggleTomb(socket.id);
    if (cb) cb(res);
  });

  socket.on('barricade_interact', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const res = mainRoom.handleBarricadeInteract(socket.id);
    if (cb) cb(res);
  });

  socket.on('tribunal_vote', (choice: string) => {
    mainRoom.handleTribunalVote(socket.id, choice);
  });

  socket.on(
    'tribunal_chat',
    (text: string, cb?: (res: { ok: boolean; filtered?: boolean; message?: string }) => void) => {
      const res = mainRoom.handleTribunalChat(socket.id, text);
      if (cb) cb(res);
    }
  );

  socket.on('tribunal_skip_turn', () => {
    mainRoom.advanceTribunalTurnNow();
  });

  socket.on(
    'debug_role',
    (role: 'WEREWOLF' | 'HUNTER_VILLAGER' | 'FORCE_TRIBUNAL' | 'FORCE_BLOOD_MOON') => {
      mainRoom.debugSetRole(socket.id, role);
    }
  );

  socket.on('spin_victory_wheel', (angleDeg: number, cb?: (res: any) => void) => {
    const res = mainRoom.handleSpinVictoryWheel(socket.id, angleDeg);
    if (cb) cb(res);
  });

  socket.on('disconnect', () => {
    mainRoom.removePlayer(socket.id);
  });
});

// Game Loop autoritativo (12.5 ticks/segundo = 80ms com volatile emit para NUNCA acumular fila de pacotes no boot do cliente!)
setInterval(() => {
  mainRoom.tick(80);
  for (const [socketId, socket] of io.of('/').sockets) {
    socket.volatile.emit('snapshot', mainRoom.getSnapshotForPlayer(socketId));
  }
}, 80);

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`[Eclipse no Vilarejo] Servidor Autoritativo rodando na porta ${PORT}`);
});
