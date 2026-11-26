import Phaser from 'phaser';
import { io } from 'socket.io-client';
import { BrazilianRoomSummary, WorldSnapshot } from '../shared/types';
import { UIController } from './uiController';
import { VillageScene } from './VillageScene';

const socket = io({
  query: {
    name: 'Você (Jogador)',
    xp: '15000'
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
