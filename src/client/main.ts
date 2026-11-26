import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { BrazilianRoomSummary, WorldSnapshot } from '../shared/types';
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
  }
});

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

export { game };
