import cors from 'cors';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { sanitizeTribunalChatMessage } from '../shared/profanityFilter';
import { BrazilianRoomSummary, ClassId } from '../shared/types';
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

// 6 Salas Brasileiras Oficiais (por enquanto apenas servidores do Brasil!)
const BRAZILIAN_ROOMS_CONFIG = [
  {
    id: 'br_sp_mantiqueira',
    name: 'Sala Brasil #1 — Serra da Mantiqueira',
    region: 'BR • Sudeste (São Paulo • 12ms)',
    requiredPlayers: 9,
    maxPlayers: 12
  },
  {
    id: 'br_mg_ouro_preto',
    name: 'Sala Brasil #2 — Vila de Ouro Preto',
    region: 'BR • Sudeste (Minas Gerais • 15ms)',
    requiredPlayers: 9,
    maxPlayers: 12
  },
  {
    id: 'br_rs_pampa_noturno',
    name: 'Sala Brasil #3 — Pampa Noturno',
    region: 'BR • Sul (Porto Alegre • 19ms)',
    requiredPlayers: 9,
    maxPlayers: 12
  },
  {
    id: 'br_ba_chapada_diamantina',
    name: 'Sala Brasil #4 — Chapada Diamantina',
    region: 'BR • Nordeste (Salvador • 24ms)',
    requiredPlayers: 9,
    maxPlayers: 12
  },
  {
    id: 'br_am_igarape_sombrio',
    name: 'Sala Brasil #5 — Igarapé Sombrio',
    region: 'BR • Norte (Manaus • 32ms)',
    requiredPlayers: 9,
    maxPlayers: 12
  },
  {
    id: 'br_go_lua_cerrado',
    name: 'Sala Brasil #6 — Lua do Cerrado',
    region: 'BR • Centro-Oeste (Goiânia • 18ms)',
    requiredPlayers: 9,
    maxPlayers: 12
  }
];

const rooms = new Map<string, GameRoom>();
for (const cfg of BRAZILIAN_ROOMS_CONFIG) {
  rooms.set(
    cfg.id,
    new GameRoom(cfg.id, io, cfg.name, cfg.region, cfg.requiredPlayers, cfg.maxPlayers)
  );
}

const DEFAULT_ROOM_ID = BRAZILIAN_ROOMS_CONFIG[0].id;
const socketToRoom = new Map<string, string>();
const socketMeta = new Map<string, { name: string; xp: number; token: string }>();
const tokenPenaltyTimeout = new Map<string, number>(); // token -> timestamp limite de bloqueio de matchmaking (60s)

function getAllRoomsSummary(): BrazilianRoomSummary[] {
  return Array.from(rooms.values()).map((r) => r.getRoomSummary());
}

function getRoomOfSocket(socketId: string): GameRoom {
  const rid = socketToRoom.get(socketId) || DEFAULT_ROOM_ID;
  return rooms.get(rid) || rooms.get(DEFAULT_ROOM_ID)!;
}

io.on('connection', (socket) => {
  const playerName =
    (socket.handshake.query.name as string) || `Morador_${socket.id.slice(0, 4)}`;
  const initialXp = Number(socket.handshake.query.xp) || 15000;
  const sessionToken =
    (socket.handshake.query.token as string) || `tok_${socket.id}`;
  const requestedRoomId = (socket.handshake.query.roomId as string) || DEFAULT_ROOM_ID;

  // Verifica se o jogador já estava em alguma sala com janela de reconexão de 45s aberta!
  let reconnectedRoom: GameRoom | null = null;
  let reconnectedPlayerId: string | null = null;
  for (const r of rooms.values()) {
    const existing = r.findPlayerBySessionToken(sessionToken);
    if (existing) {
      reconnectedRoom = r;
      reconnectedPlayerId = existing.id;
      break;
    }
  }

  let initialRoom: GameRoom;
  if (reconnectedRoom && reconnectedPlayerId) {
    initialRoom = reconnectedRoom;
    initialRoom.reconnectPlayerSocket(reconnectedPlayerId, socket.id, sessionToken);
    socketMeta.set(socket.id, { name: playerName, xp: initialXp, token: sessionToken });
    socketToRoom.set(socket.id, initialRoom.roomId);
    socket.join(initialRoom.roomId);
  } else {
    const targetRoomId = rooms.has(requestedRoomId) ? requestedRoomId : DEFAULT_ROOM_ID;
    socketMeta.set(socket.id, { name: playerName, xp: initialXp, token: sessionToken });
    socketToRoom.set(socket.id, targetRoomId);

    initialRoom = rooms.get(targetRoomId)!;
    initialRoom.addPlayer(socket.id, playerName, false, initialXp, sessionToken);
    socket.join(targetRoomId);
  }

  socket.emit('rooms_list', getAllRoomsSummary());
  socket.emit('snapshot', initialRoom.getSnapshotForPlayer(socket.id));

  socket.on('list_rooms', (cb?: (list: BrazilianRoomSummary[]) => void) => {
    const list = getAllRoomsSummary();
    socket.emit('rooms_list', list);
    if (cb) cb(list);
  });

  socket.on(
    'join_room',
    (
      payload: { roomId: string; playerName?: string },
      cb?: (res: { ok: boolean; message: string; room?: BrazilianRoomSummary }) => void
    ) => {
      const nextRoom = rooms.get(payload?.roomId);
      if (!nextRoom) {
        if (cb) cb({ ok: false, message: 'Sala brasileira não encontrada!' });
        return;
      }

      const meta = socketMeta.get(socket.id) || {
        name: playerName,
        xp: initialXp,
        token: sessionToken
      };
      const penaltyEnds = tokenPenaltyTimeout.get(meta.token) || 0;
      if (Date.now() < penaltyEnds && nextRoom.roomId !== socketToRoom.get(socket.id)) {
        const remSec = Math.ceil((penaltyEnds - Date.now()) / 1000);
        if (cb) {
          cb({
            ok: false,
            message: `Bloqueio de Matchmaking por abandono de partida! Aguarde ${remSec}s para trocar de sala.`
          });
        }
        return;
      }
      if (payload.playerName && payload.playerName.trim()) {
        meta.name = payload.playerName.trim().slice(0, 22);
        socketMeta.set(socket.id, meta);
      }

      const prevRoomId = socketToRoom.get(socket.id);
      if (prevRoomId && prevRoomId !== nextRoom.roomId) {
        const prevRoom = rooms.get(prevRoomId);
        prevRoom?.removePlayer(socket.id);
        socket.leave(prevRoomId);
      }

      socketToRoom.set(socket.id, nextRoom.roomId);
      socket.join(nextRoom.roomId);

      // Remove se já existia e readiciona com o nome atualizado
      nextRoom.removePlayer(socket.id);
      nextRoom.addPlayer(socket.id, meta.name, false, meta.xp, meta.token);

      io.emit('rooms_list', getAllRoomsSummary());
      socket.emit('snapshot', nextRoom.getSnapshotForPlayer(socket.id));

      if (cb) {
        cb({
          ok: true,
          message: `Você entrou em [${nextRoom.roomName}] (${nextRoom.getRoomSummary().playerCount}/${nextRoom.requiredPlayers} jogadores)!`,
          room: nextRoom.getRoomSummary()
        });
      }
    }
  );

  // Permitir que os próprios jogadores criem suas salas personalizadas brasileiras
  socket.on(
    'create_room',
    (
      payload: {
        roomName: string;
        regionLabel?: string;
        requiredPlayers?: number;
        playerName?: string;
      },
      cb?: (res: { ok: boolean; message: string; room?: BrazilianRoomSummary }) => void
    ) => {
      const rawRoomName = (payload?.roomName || '').trim();
      if (!rawRoomName) {
        if (cb) cb({ ok: false, message: 'Digite um nome para a sua sala!' });
        return;
      }

      const meta = socketMeta.get(socket.id) || {
        name: playerName,
        xp: initialXp,
        token: sessionToken
      };
      const penaltyEnds = tokenPenaltyTimeout.get(meta.token) || 0;
      if (Date.now() < penaltyEnds) {
        const remSec = Math.ceil((penaltyEnds - Date.now()) / 1000);
        if (cb) {
          cb({
            ok: false,
            message: `Bloqueio de Matchmaking por abandono de partida! Aguarde ${remSec}s para criar uma nova sala.`
          });
        }
        return;
      }
      if (payload.playerName && payload.playerName.trim()) {
        const cleanPlayerName = sanitizeTribunalChatMessage(payload.playerName.trim()).cleanText.slice(0, 22);
        meta.name = cleanPlayerName || meta.name;
        socketMeta.set(socket.id, meta);
      }

      const sanitizedRoom = sanitizeTribunalChatMessage(rawRoomName);
      const finalRoomName = sanitizedRoom.cleanText.slice(0, 34) || `Sala de ${meta.name}`;
      const finalRegion =
        (payload.regionLabel && payload.regionLabel.trim().slice(0, 44)) ||
        'BR • Sudeste (São Paulo • 12ms)';
      const reqPlayers = Math.max(4, Math.min(12, Number(payload.requiredPlayers) || 9));
      const maxPlayers = Math.max(reqPlayers, 12);

      const customRoomId = `br_custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const customRoom = new GameRoom(
        customRoomId,
        io,
        finalRoomName,
        finalRegion,
        reqPlayers,
        maxPlayers,
        true,
        meta.name
      );
      rooms.set(customRoomId, customRoom);

      const prevRoomId = socketToRoom.get(socket.id);
      if (prevRoomId && prevRoomId !== customRoomId) {
        const prevRoom = rooms.get(prevRoomId);
        prevRoom?.removePlayer(socket.id);
        socket.leave(prevRoomId);
      }

      socketToRoom.set(socket.id, customRoomId);
      socket.join(customRoomId);
      customRoom.addPlayer(socket.id, meta.name, false, meta.xp, meta.token);
      customRoom.addLog(
        `Sala brasileira [${finalRoomName}] criada por ${meta.name} (Mínimo: ${reqPlayers} jogadores).`
      );

      io.emit('rooms_list', getAllRoomsSummary());
      socket.emit('snapshot', customRoom.getSnapshotForPlayer(socket.id));

      if (cb) {
        cb({
          ok: true,
          message: `Sala [${finalRoomName}] criada com sucesso! Aguardando ${customRoom.getRoomSummary().playerCount}/${reqPlayers} jogadores.`,
          room: customRoom.getRoomSummary()
        });
      }
    }
  );

  // Simular entrada de +1 jogador brasileiro na sala atual (para acumular até 9/9 e disparar a contagem regressiva!)
  socket.on('lobby_add_player', (cb?: (res: any) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.addSimulatedLobbyPlayer();
    io.emit('rooms_list', getAllRoomsSummary());
    if (cb) cb(res);
  });

  // Simular saída de 1 jogador da sala atual (se o time estava completo 9/9, o contador ZERA na hora!)
  socket.on('lobby_remove_player', (cb?: (res: any) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.removeSimulatedLobbyPlayer();
    io.emit('rooms_list', getAllRoomsSummary());
    if (cb) cb(res);
  });

  // Voltar a sala atual para o Lobby de espera mantendo todos os jogadores que terminaram a partida na mesma sala
  socket.on('return_to_lobby', (cb?: (res: { ok: boolean }) => void) => {
    const room = getRoomOfSocket(socket.id);
    room.returnToLobby(true);
    io.emit('rooms_list', getAllRoomsSummary());
    if (cb) cb({ ok: true });
  });

  // Chat da Sala de Espera (Lobby) na Praça da Catedral Central com Filtro de Ofensas
  socket.on(
    'lobby_chat',
    (text: string, cb?: (res: { ok: boolean; filtered?: boolean; message?: string }) => void) => {
      const room = getRoomOfSocket(socket.id);
      const res = room.handleLobbyChat(socket.id, text);
      if (cb) cb(res);
    }
  );

  socket.on('select_class', (classId: ClassId, cb?: (res: { ok: boolean; reason?: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.selectClass(socket.id, classId);
    if (cb) cb(res);
  });

  socket.on('start_match', (botCount = 9) => {
    const room = getRoomOfSocket(socket.id);
    room.startMatchWithBots(botCount);
    io.emit('rooms_list', getAllRoomsSummary());
  });

  socket.on(
    'move',
    (payload: { dx: number; dy: number; angle: number; x?: number; y?: number }) => {
      const room = getRoomOfSocket(socket.id);
      room.handleMove(
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
    const room = getRoomOfSocket(socket.id);
    const res = room.handleMissionInteract(socket.id);
    if (cb) cb(res);
  });

  socket.on('use_ability', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleUseAbility(socket.id);
    if (cb) cb(res);
  });

  socket.on('werewolf_transform', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleWerewolfTransform(socket.id);
    if (cb) cb(res);
  });

  socket.on('report_or_bell', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleReportOrBell(socket.id);
    if (cb) cb(res);
  });

  socket.on('toggle_barrel', (cb?: (res: any) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleToggleBarrel(socket.id);
    if (cb) cb(res);
  });

  socket.on('toggle_tomb', (cb?: (res: any) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleToggleTomb(socket.id);
    if (cb) cb(res);
  });

  socket.on('barricade_interact', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleBarricadeInteract(socket.id);
    if (cb) cb(res);
  });

  socket.on('tribunal_vote', (choice: string) => {
    const room = getRoomOfSocket(socket.id);
    room.handleTribunalVote(socket.id, choice);
  });

  socket.on(
    'tribunal_chat',
    (text: string, cb?: (res: { ok: boolean; filtered?: boolean; message?: string }) => void) => {
      const room = getRoomOfSocket(socket.id);
      const res = room.handleTribunalChat(socket.id, text);
      if (cb) cb(res);
    }
  );

  socket.on('tribunal_skip_turn', () => {
    const room = getRoomOfSocket(socket.id);
    room.advanceTribunalTurnNow();
  });

  socket.on(
    'debug_role',
    (role: 'WEREWOLF' | 'HUNTER_VILLAGER' | 'FORCE_TRIBUNAL' | 'FORCE_BLOOD_MOON') => {
      const room = getRoomOfSocket(socket.id);
      room.debugSetRole(socket.id, role);
    }
  );

  socket.on('spin_victory_wheel', (angleDeg: number, cb?: (res: any) => void) => {
    const room = getRoomOfSocket(socket.id);
    const res = room.handleSpinVictoryWheel(socket.id, angleDeg);
    if (cb) cb(res);
  });

  // Simular queda de conexão (inicia a janela de 45s com Piloto Automático) ou Reconexão imediata
  socket.on('simulate_disconnect_45s', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    room.handlePlayerDisconnect(socket.id);
    if (cb) {
      cb({
        ok: true,
        message: 'Conexão simulada como CAÍDA! Piloto Automático ativo por 45s — clique em Reconectar antes de esgotar!'
      });
    }
  });

  socket.on('simulate_reconnect_now', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const meta = socketMeta.get(socket.id);
    room.reconnectPlayerSocket(socket.id, socket.id, meta?.token || `tok_${socket.id}`);
    if (cb) {
      cb({
        ok: true,
        message: 'Você RECONECTOU dentro dos 45s e retomou o controle do seu personagem!'
      });
    }
  });

  // Abandonar partida voluntariamente (aplica -100 XP, bloqueio de matchmaking de 60s e transfere Lobo/Caçador imediatamente!)
  socket.on('abandon_match', (cb?: (res: { ok: boolean; message: string }) => void) => {
    const room = getRoomOfSocket(socket.id);
    const meta = socketMeta.get(socket.id);
    if (meta?.token) {
      tokenPenaltyTimeout.set(meta.token, Date.now() + 60000);
    }
    room.resolveExpiredReconnectOrAbandon(socket.id, 'Abandono de partida');
    if (cb) {
      cb({
        ok: true,
        message:
          'Partida abandonada (-100 XP e bloqueio de 60s para trocar de sala). Sucessão da Maldição / Relíquia do Caçador acionada!'
      });
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomOfSocket(socket.id);
    room.handlePlayerDisconnect(socket.id);
    socketToRoom.delete(socket.id);
    socketMeta.delete(socket.id);
    io.emit('rooms_list', getAllRoomsSummary());
  });
});

// Game Loop autoritativo (12.5 ticks/segundo = 80ms) para todas as Salas Brasileiras!
let roomsListBroadcastTick = 0;
setInterval(() => {
  for (const room of rooms.values()) {
    room.tick(80);
  }
  for (const [socketId, socket] of io.of('/').sockets) {
    const room = getRoomOfSocket(socketId);
    socket.volatile.emit('snapshot', room.getSnapshotForPlayer(socketId));
  }
  roomsListBroadcastTick++;
  if (roomsListBroadcastTick % 6 === 0) {
    io.volatile.emit('rooms_list', getAllRoomsSummary());
  }
}, 80);

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => {
  console.log(`[Eclipse no Vilarejo] Servidor Autoritativo BR rodando na porta ${PORT} (${rooms.size} salas brasileiras ativas)`);
});
