import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { GameRoom } from '../server/GameRoom';
import { sanitizeTribunalChatMessage } from '../shared/profanityFilter';
import { BrazilianRoomSummary, ClassId, WorldSnapshot } from '../shared/types';
import { UIController } from './uiController';
import { VillageScene } from './VillageScene';

// Token persistente de sessão no navegador/celular para permitir Reconexão em até 45 segundos se a internet oscilar!
const STORAGE_TOKEN_KEY = 'eclipse_vilarejo_session_token';
let sessionToken = window.localStorage.getItem(STORAGE_TOKEN_KEY);
if (!sessionToken) {
  sessionToken = `br_tok_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(STORAGE_TOKEN_KEY, sessionToken);
}

const socket = io({
  query: {
    name: 'Você (Jogador)',
    xp: '15000',
    token: sessionToken
  },
  reconnectionAttempts: 2,
  timeout: 2200
});

// ============================================================================
// MODO SERVIDOR LOCAL EMBUTIDO (Para Deploy Estático na Vercel / Offline!):
// Se o cliente estiver rodando na Vercel (sem servidor WebSocket Node externo),
// ativa automaticamente as 6 Salas Brasileiras localmente no navegador com 100%
// da lógica autoritativa do GameRoom!
// ============================================================================
let localEmbeddedActive = false;
const LOCAL_PLAYER_ID = 'local_player_br';
const localRooms = new Map<string, GameRoom>();
let currentLocalRoomId = 'br_sp_mantiqueira';
let localPlayerName = 'Você (Jogador)';
const localPlayerXp = 15000;

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

function getLocalRoomsSummary(): BrazilianRoomSummary[] {
  return Array.from(localRooms.values()).map((r) => r.getRoomSummary());
}

function getActiveLocalRoom(): GameRoom {
  return localRooms.get(currentLocalRoomId) || Array.from(localRooms.values())[0];
}

const originalEmit = socket.emit.bind(socket);
(socket as any).emit = (event: string, ...args: any[]) => {
  if (!localEmbeddedActive) {
    return originalEmit(event, ...args);
  }

  const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
  const payload = args[0];
  const room = getActiveLocalRoom();

  switch (event) {
    case 'list_rooms': {
      const list = getLocalRoomsSummary();
      ui.updateRoomsList(list);
      if (cb) cb(list);
      break;
    }
    case 'join_room': {
      const nextRoom = localRooms.get(payload?.roomId);
      if (!nextRoom) {
        if (cb) cb({ ok: false, message: 'Sala brasileira não encontrada!' });
        break;
      }
      if (payload?.playerName?.trim()) {
        localPlayerName = payload.playerName.trim().slice(0, 22);
      }
      if (currentLocalRoomId !== nextRoom.roomId) {
        room.removePlayer(LOCAL_PLAYER_ID);
      }
      currentLocalRoomId = nextRoom.roomId;
      nextRoom.removePlayer(LOCAL_PLAYER_ID);
      nextRoom.addPlayer(LOCAL_PLAYER_ID, localPlayerName, false, localPlayerXp, sessionToken!);
      ui.updateRoomsList(getLocalRoomsSummary());
      const snap = nextRoom.getSnapshotForPlayer(LOCAL_PLAYER_ID);
      villageScene.updateSnapshot(snap);
      ui.updateFromSnapshot(snap);
      if (cb) {
        cb({
          ok: true,
          message: `Você entrou em [${nextRoom.roomName}] (${nextRoom.getRoomSummary().playerCount}/${nextRoom.requiredPlayers} jogadores)!`,
          room: nextRoom.getRoomSummary()
        });
      }
      break;
    }
    case 'create_room': {
      const rawRoomName = (payload?.roomName || '').trim();
      if (!rawRoomName) {
        if (cb) cb({ ok: false, message: 'Digite um nome para a sua sala!' });
        break;
      }
      if (payload?.playerName?.trim()) {
        localPlayerName =
          sanitizeTribunalChatMessage(payload.playerName.trim()).cleanText.slice(0, 22) ||
          localPlayerName;
      }
      const finalRoomName =
        sanitizeTribunalChatMessage(rawRoomName).cleanText.slice(0, 34) ||
        `Sala de ${localPlayerName}`;
      const finalRegion =
        (payload?.regionLabel && payload.regionLabel.trim().slice(0, 44)) ||
        'BR • Sudeste (São Paulo • 12ms)';
      const reqPlayers = Math.max(4, Math.min(12, Number(payload?.requiredPlayers) || 9));
      const customRoomId = `br_custom_${Date.now()}`;
      const customRoom = new GameRoom(
        customRoomId,
        undefined,
        finalRoomName,
        finalRegion,
        reqPlayers,
        12,
        true,
        localPlayerName
      );
      localRooms.set(customRoomId, customRoom);
      room.removePlayer(LOCAL_PLAYER_ID);
      currentLocalRoomId = customRoomId;
      customRoom.addPlayer(LOCAL_PLAYER_ID, localPlayerName, false, localPlayerXp, sessionToken!);
      ui.updateRoomsList(getLocalRoomsSummary());
      const snap = customRoom.getSnapshotForPlayer(LOCAL_PLAYER_ID);
      villageScene.updateSnapshot(snap);
      ui.updateFromSnapshot(snap);
      if (cb) {
        cb({
          ok: true,
          message: `Sala [${finalRoomName}] criada com sucesso!`,
          room: customRoom.getRoomSummary()
        });
      }
      break;
    }
    case 'lobby_add_player': {
      const res = room.addSimulatedLobbyPlayer();
      ui.updateRoomsList(getLocalRoomsSummary());
      if (cb) cb(res);
      break;
    }
    case 'lobby_remove_player': {
      const res = room.removeSimulatedLobbyPlayer();
      ui.updateRoomsList(getLocalRoomsSummary());
      if (cb) cb(res);
      break;
    }
    case 'return_to_lobby': {
      room.returnToLobby(true);
      ui.updateRoomsList(getLocalRoomsSummary());
      if (cb) cb({ ok: true });
      break;
    }
    case 'lobby_chat': {
      const res = room.handleLobbyChat(LOCAL_PLAYER_ID, payload);
      if (cb) cb(res);
      break;
    }
    case 'select_class': {
      const res = room.selectClass(LOCAL_PLAYER_ID, payload as ClassId);
      if (cb) cb(res);
      break;
    }
    case 'start_match': {
      room.startMatchWithBots(typeof payload === 'number' ? payload : 9);
      ui.updateRoomsList(getLocalRoomsSummary());
      break;
    }
    case 'move': {
      if (payload) {
        room.handleMove(
          LOCAL_PLAYER_ID,
          payload.dx,
          payload.dy,
          payload.angle,
          payload.x,
          payload.y
        );
      }
      break;
    }
    case 'mission_interact': {
      const res = room.handleMissionInteract(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'use_ability': {
      const res = room.handleUseAbility(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'werewolf_transform': {
      const res = room.handleWerewolfTransform(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'report_or_bell': {
      const res = room.handleReportOrBell(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'toggle_barrel': {
      const res = room.handleToggleBarrel(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'toggle_tomb': {
      const res = room.handleToggleTomb(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'barricade_interact': {
      const res = room.handleBarricadeInteract(LOCAL_PLAYER_ID);
      if (cb) cb(res);
      break;
    }
    case 'tribunal_vote': {
      room.handleTribunalVote(LOCAL_PLAYER_ID, payload);
      break;
    }
    case 'tribunal_chat': {
      const res = room.handleTribunalChat(LOCAL_PLAYER_ID, payload);
      if (cb) cb(res);
      break;
    }
    case 'tribunal_skip_turn': {
      room.advanceTribunalTurnNow();
      break;
    }
    case 'debug_role': {
      room.debugSetRole(LOCAL_PLAYER_ID, payload);
      break;
    }
    case 'spin_victory_wheel': {
      const res = room.handleSpinVictoryWheel(LOCAL_PLAYER_ID, payload);
      if (cb) cb(res);
      break;
    }
    case 'simulate_disconnect_45s': {
      room.handlePlayerDisconnect(LOCAL_PLAYER_ID);
      if (cb) {
        cb({
          ok: true,
          message:
            'Conexão simulada como CAÍDA! Piloto Automático ativo por 45s — clique em Reconectar antes de esgotar!'
        });
      }
      break;
    }
    case 'simulate_reconnect_now': {
      room.reconnectPlayerSocket(LOCAL_PLAYER_ID, LOCAL_PLAYER_ID, sessionToken!);
      if (cb) {
        cb({
          ok: true,
          message: 'Você RECONECTOU dentro dos 45s e retomou o controle do seu personagem!'
        });
      }
      break;
    }
    case 'abandon_match': {
      room.resolveExpiredReconnectOrAbandon(LOCAL_PLAYER_ID, 'Abandono de partida');
      if (cb) {
        cb({
          ok: true,
          message:
            'Partida abandonada (-100 XP). Sucessão da Maldição / Relíquia do Caçador acionada!'
        });
      }
      break;
    }
  }
  return socket;
};

function startEmbeddedLocalServerFallback() {
  if (localEmbeddedActive || socket.connected) return;
  localEmbeddedActive = true;
  (socket as any).id = LOCAL_PLAYER_ID;

  for (const cfg of BRAZILIAN_ROOMS_CONFIG) {
    localRooms.set(
      cfg.id,
      new GameRoom(cfg.id, undefined, cfg.name, cfg.region, cfg.requiredPlayers, cfg.maxPlayers)
    );
  }

  const initialRoom = getActiveLocalRoom();
  initialRoom.addPlayer(LOCAL_PLAYER_ID, localPlayerName, false, localPlayerXp, sessionToken!);

  ui.updateRoomsList(getLocalRoomsSummary());
  const firstSnap = initialRoom.getSnapshotForPlayer(LOCAL_PLAYER_ID);
  villageScene.updateSnapshot(firstSnap);
  ui.updateFromSnapshot(firstSnap);

  let tickCounter = 0;
  window.setInterval(() => {
    for (const r of localRooms.values()) {
      r.tick(80);
    }
    const active = getActiveLocalRoom();
    const snap = active.getSnapshotForPlayer(LOCAL_PLAYER_ID);
    villageScene.updateSnapshot(snap);
    ui.updateFromSnapshot(snap);
    tickCounter++;
    if (tickCounter % 6 === 0) {
      ui.updateRoomsList(getLocalRoomsSummary());
    }
  }, 80);
}

const ui = new UIController(socket);
const villageScene = new VillageScene(socket, (msg) => ui.showToast(msg));
ui.attachScene(villageScene);

const container = document.getElementById('phaser-container');

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'phaser-container',
  width: container?.clientWidth || window.innerWidth,
  height: container?.clientHeight || window.innerHeight,
  backgroundColor: '#070a0f',
  scene: [villageScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

socket.on('rooms_list', (rooms: BrazilianRoomSummary[]) => {
  ui.updateRoomsList(rooms);
});

socket.on('snapshot', (snap: WorldSnapshot) => {
  villageScene.updateSnapshot(snap);
  ui.updateFromSnapshot(snap);
});

socket.on('connect_error', () => {
  startEmbeddedLocalServerFallback();
});

window.setTimeout(() => {
  if (!socket.connected) {
    startEmbeddedLocalServerFallback();
  }
}, 1400);

export { game };
