import Phaser from 'phaser';
import { Socket } from 'socket.io-client';
import { CLASSES_BY_ID } from '../shared/classesData';
import {
  BARRICADE_INTERACT_RADIUS,
  BARRICADE_REMOVE_DURATION_MS,
  BARREL_INTERACT_RADIUS,
  CHURCH_CENTER,
  GIANT_ANCIENT_TREE,
  HIDING_BARRELS,
  LOBBY_PASSAGE_FENCES,
  LOBBY_WARDROBE_INTERACT_RADIUS,
  LOBBY_WARDROBE_POS,
  MAP_HEIGHT,
  MAP_WIDTH,
  SHALLOW_LAKE_ZONE,
  TOMB_INTERACT_RADIUS,
  VILLAGE_ZONES,
  WEREWOLF_TOMBS,
  isPlayerHiddenByEnvironment,
  isOnPathOrClearing,
  isPointInChurchSacredGround,
  isPointInCornfield,
  isPointInRunicCircle,
  isPointInShallowLake,
  isPointInZone,
  resolveLobbyFenceCollisions,
  resolveMapCollisions
} from '../shared/mapData';
import { PlayerState, WorldSnapshot } from '../shared/types';
import { AssetGenerator } from './AssetGenerator';

interface PlayerVisualNode {
  sprite: Phaser.GameObjects.Sprite;
  selectionRing: Phaser.GameObjects.Ellipse;
  shieldRing: Phaser.GameObjects.Ellipse;
  nameTag: Phaser.GameObjects.Text;
  speechBubble: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  animTimer: number;
  animFrame: number;
  facingLeft: boolean;
  wasAbilityUnlocked: boolean;
  lastRustleX: number;
  lastRustleY: number;
}

export class VillageScene extends Phaser.Scene {
  private socket: Socket;
  private snapshot: WorldSnapshot | null = null;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    B: Phaser.Input.Keyboard.Key;
    E: Phaser.Input.Keyboard.Key;
    F: Phaser.Input.Keyboard.Key;
    T: Phaser.Input.Keyboard.Key;
    R: Phaser.Input.Keyboard.Key;
    Q: Phaser.Input.Keyboard.Key;
    SPACE: Phaser.Input.Keyboard.Key;
  };

  public joystickDx: number = 0;
  public joystickDy: number = 0;

  public predictedX: number = CHURCH_CENTER.x;
  public predictedY: number = CHURCH_CENTER.y;
  private hasInitializedPrediction: boolean = false;
  private lastNetSyncTime: number = 0;
  private lastMoveWallClock: number = performance.now();
  private lastKnownPhase: string = 'LOBBY';

  private overlayGraphics!: Phaser.GameObjects.Graphics;
  private visionVignette!: Phaser.GameObjects.Image;
  private cornfieldChunkSprite!: Phaser.GameObjects.Image;
  private churchBellSprite!: Phaser.GameObjects.Image;
  private lastCornRustleSpawnAt: number = 0;

  private playerNodes: Map<string, PlayerVisualNode> = new Map();
  private totemSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private trapSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private corpseSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private hidingBarrelSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private werewolfTombSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private barricadeSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private lobbyFenceSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private hunterRelicSprite: Phaser.GameObjects.Image | null = null;
  private hunterRelicLabel: Phaser.GameObjects.Text | null = null;

  private onToast: (msg: string) => void;

  constructor(socket: Socket, onToast: (msg: string) => void) {
    super({ key: 'VillageScene' });
    this.socket = socket;
    this.onToast = onToast;
  }

  public updateSnapshot(snap: WorldSnapshot) {
    const me = snap.players.find((p) => p.id === this.socket.id);
    if (me) {
      const serverDist = Math.hypot(me.x - this.predictedX, me.y - this.predictedY);
      if (
        !this.hasInitializedPrediction ||
        snap.phase !== this.lastKnownPhase ||
        me.hiddenInBarrelId ||
        me.hiddenInTombId ||
        serverDist > 110
      ) {
        this.predictedX = me.x;
        this.predictedY = me.y;
        this.hasInitializedPrediction = true;
      }

      me.x = Math.round(this.predictedX);
      me.y = Math.round(this.predictedY);
    }

    this.lastKnownPhase = snap.phase;
    this.snapshot = snap;
  }

  create() {
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    AssetGenerator.generateAll(this);
    this.buildOrganicVillageWorld();

    this.overlayGraphics = this.add.graphics().setDepth(4500);

    this.visionVignette = this.add
      .image(this.scale.width / 2, this.scale.height / 2, 'vignette_vision')
      .setScrollFactor(0)
      .setDepth(5000);
    this.updateVignetteSize(this.scale.width, this.scale.height, false);

    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      if (this.visionVignette) {
        this.visionVignette.setPosition(gameSize.width / 2, gameSize.height / 2);
        this.updateVignetteSize(
          gameSize.width,
          gameSize.height,
          this.snapshot?.eclipseActive || false
        );
      }
    });

    this.setupKeyboardControls();
  }

  private updateVignetteSize(w: number, h: number, isEclipse: boolean) {
    if (!this.visionVignette) return;
    // A máscara da vinheta SEMPRE precisa cobrir no mínimo toda a largura e altura da tela (w, h),
    // inclusive durante o Eclipse Lunar, para jamais deixar faixas claras sobrando nas laterais!
    const coverW = Math.max(w, h) * 1.35;
    const coverH = Math.max(w, h) * 1.35;
    if (isEclipse) {
      this.visionVignette.setDisplaySize(coverW, coverH);
      this.visionVignette.setAlpha(0.96);
    } else {
      this.visionVignette.setDisplaySize(coverW * 1.3, coverH * 1.3);
      this.visionVignette.setAlpha(0.55);
    }
  }

  /**
   * Constrói o Vilarejo Orgânico Amplo (4200x2800) onde CADA território tem personalidade e mecânica exclusiva!
   */
  private buildOrganicVillageWorld() {
    // 1. Terreno Orgânico Base Pré-Renderizado (Clareiras + Lago Raso + Trilhas Sinuosas + Bosques Naturais + Rio Leste)
    this.add
      .image(MAP_WIDTH / 2, MAP_HEIGHT / 2, 'baked_skeld_village_layout')
      .setScale(2)
      .setDepth(1);

    // 1.1. Dossel Superior da Floresta Densa (Renderizado ACIMA dos personagens para cobrir o Lobisomem quando ele entra na floresta!)
    this.add
      .image(MAP_WIDTH / 2, MAP_HEIGHT / 2, 'baked_dense_forest_canopy')
      .setScale(2)
      .setDepth(3850);

    // 2. TERRITÓRIO CENTRAL: Praça da Catedral & Sino Sagrado (2100, 1400)
    this.add.image(CHURCH_CENTER.x, CHURCH_CENTER.y - 35, 'building_church_25d').setDepth(6);
    this.churchBellSprite = this.add
      .image(CHURCH_CENTER.x, CHURCH_CENTER.y + 15, 'prop_bell_25d')
      .setOrigin(0.5, 0.78)
      .setDepth(CHURCH_CENTER.y + 15);

    // Altar Sagrado da Igreja (no topo do tapete vermelho da Catedral: caminhe até o Altar no Lobby e aperte [E] para escolher seu personagem!)
    this.add
      .image(LOBBY_WARDROBE_POS.x, LOBBY_WARDROBE_POS.y, 'prop_wardrobe_25d')
      .setOrigin(0.5, 0.82)
      .setDepth(LOBBY_WARDROBE_POS.y);
    this.add
      .text(LOBBY_WARDROBE_POS.x, LOBBY_WARDROBE_POS.y - 68, 'ALTAR DE PERSONAGENS [E]', {
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#060907',
        strokeThickness: 4
      })
      .setOrigin(0.5)
      .setDepth(4150);

    // Braseiros de Fogo Vivo cercando a Praça da Catedral
    [
      { x: 1780, y: 1180 },
      { x: 2420, y: 1180 },
      { x: 1780, y: 1620 },
      { x: 2420, y: 1620 }
    ].forEach((bp) => {
      this.add.image(bp.x, bp.y, 'prop_stone_pillar_25d').setOrigin(0.5, 0.88).setDepth(bp.y);
      this.add.image(bp.x, bp.y - 42, 'warm_lamp_glow').setDepth(bp.y + 1);
    });

    // 3. TERRITÓRIO NOROESTE (MECÂNICA DO LAGO RASO QUE DESACELERA): Ilhota do Poço Antigo (670, 680)
    this.add
      .image(SHALLOW_LAKE_ZONE.centerX, SHALLOW_LAKE_ZONE.centerY, 'building_well_25d')
      .setOrigin(0.5, 0.85)
      .setDepth(SHALLOW_LAKE_ZONE.centerY);

    // 4. TERRITÓRIO NORTE (MECÂNICA DA GRANDE ÁRVORE ANCESTRAL): Copa Gigante que Esconde Jogadores (2100, 460)
    this.add
      .image(GIANT_ANCIENT_TREE.x, GIANT_ANCIENT_TREE.y, 'prop_giant_ancient_tree_25d')
      .setScale(1.15)
      .setDepth(3950);

    // 5. TERRITÓRIO NORTE-INTERNO (MECÂNICA DO REBANHO & FENO): Prado das Ovelhas (1400, 640)
    [
      { x: 1250, y: 520, flip: false },
      { x: 1420, y: 500, flip: true },
      { x: 1540, y: 610, flip: true },
      { x: 1290, y: 710, flip: false },
      { x: 1460, y: 740, flip: false },
      { x: 1370, y: 620, flip: true }
    ].forEach((sh) => {
      this.add
        .image(sh.x, sh.y, 'prop_sheep_25d')
        .setOrigin(0.5, 0.85)
        .setFlipX(sh.flip)
        .setDepth(sh.y);
    });
    this.add.image(1210, 465, 'prop_haybale_25d').setOrigin(0.5, 0.85).setDepth(465);
    this.add.image(1570, 770, 'prop_haybale_25d').setOrigin(0.5, 0.85).setDepth(770);

    // 6. TERRITÓRIO OESTE (MECÂNICA EXCLUSIVA DOS BARRIS DE ESCONDERIJO!): Vila das Cabanas (680, 1400)
    [
      { x: 460, y: 1210 },
      { x: 860, y: 1210 },
      { x: 470, y: 1610 },
      { x: 870, y: 1610 }
    ].forEach((c) => {
      this.add.image(c.x, c.y, 'building_cottage_25d').setOrigin(0.5, 0.86).setDepth(c.y);
      this.add.image(c.x, c.y - 25, 'warm_lamp_glow').setDepth(c.y + 1);
    });
    // Fogueira central do acampamento das cabanas
    this.add.image(660, 1330, 'prop_campfire_25d').setOrigin(0.5, 0.85).setDepth(1330);
    this.add.image(660, 1315, 'warm_lamp_glow').setScale(1.4).setDepth(1331);

    // Renderiza os 5 Barris de Esconderijo EXCLUSIVOS da Vila das Cabanas
    for (const hb of HIDING_BARRELS) {
      const spr = this.add
        .image(hb.x, hb.y, 'prop_hiding_barrel_25d')
        .setOrigin(0.5, 0.86)
        .setDepth(hb.y);
      this.hidingBarrelSprites.set(hb.id, spr);
    }

    // 7. TERRITÓRIO SUDOESTE (MECÂNICA DO MILHARAL ALTO): Fazenda do Milharal (700, 2190)
    // Moradores e o Lobo em forma humana entram escondidos SEM mexer a plantação;
    // APENAS o Lobisomem TRANSFORMADO faz o milharal balançar quando se move lá dentro!
    this.cornfieldChunkSprite = this.add
      .image(700, 2190, 'chunk_cornfield_25d')
      .setScale(2)
      .setDepth(3700);
    this.add.image(1050, 1980, 'prop_scarecrow_25d').setOrigin(0.5, 0.88).setDepth(1980);
    this.add.image(365, 1940, 'prop_haybale_25d').setOrigin(0.5, 0.85).setDepth(1940);

    // 8. TERRITÓRIO SUL-OESTE: Bosque de Caça do Sul (1560, 2220)
    this.add.image(1560, 2220, 'chunk_cedar_forest_25d').setScale(2).setDepth(3800);

    // 9. TERRITÓRIO SUL-CENTRAL (MECÂNICA DE VELOCIDADE ESPIRITUAL +22%): Círculo de Menires Rúnicos (2360, 2210)
    const stonesCenter = { x: 2360, y: 2210 };
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const sx = stonesCenter.x + Math.cos(a) * 170;
      const sy = stonesCenter.y + Math.sin(a) * 170;
      this.add
        .image(sx, sy, 'prop_gravestone_25d')
        .setTint(0xa5b4fc)
        .setScale(1.25)
        .setOrigin(0.5, 0.85)
        .setDepth(sy);
    }
    this.add
      .image(stonesCenter.x, stonesCenter.y, 'prop_stone_pillar_25d')
      .setScale(1.2)
      .setOrigin(0.5, 0.88)
      .setDepth(stonesCenter.y);

    // 10. TERRITÓRIO NORDESTE: Solar da Prefeitura (2850, 640)
    this.add.image(2720, 610, 'building_cottage_25d').setOrigin(0.5, 0.86).setDepth(610);
    this.add.image(2980, 610, 'building_cottage_25d').setOrigin(0.5, 0.86).setDepth(610);
    this.add.image(2640, 770, 'prop_stone_pillar_25d').setOrigin(0.5, 0.88).setDepth(770);
    this.add.image(3060, 770, 'prop_stone_pillar_25d').setOrigin(0.5, 0.88).setDepth(770);

    // 11. TERRITÓRIO LESTE-INTERNO: Cemitério das Brumas + Tumbas do Lobisomem (2990, 1330)
    for (let gx = 2760; gx <= 3220; gx += 115) {
      for (let gy = 1140; gy <= 1520; gy += 115) {
        // Deixa espaço no centro do cemitério para as 2 grandes Tumbas/Sarcófagos do Lobisomem
        if (Math.abs(gx - 2990) < 70) continue;
        this.add
          .image(gx, gy, 'prop_gravestone_25d')
          .setOrigin(0.5, 0.85)
          .setDepth(gy);
      }
    }
    for (const tomb of WEREWOLF_TOMBS) {
      const spr = this.add
        .image(tomb.x, tomb.y, 'prop_wolf_tomb_25d')
        .setOrigin(0.5, 0.82)
        .setDepth(tomb.y);
      this.werewolfTombSprites.set(tomb.id, spr);
    }

    // 12. TERRITÓRIO SUDESTE: Forja Vulcânica da Ferraria (3130, 2170)
    this.add.image(2960, 2090, 'building_cottage_25d').setOrigin(0.5, 0.86).setDepth(2090);
    this.add
      .image(3220, 2120, 'building_forge_25d')
      .setScale(1.2)
      .setOrigin(0.5, 0.85)
      .setDepth(2120);
    this.add.image(3220, 2080, 'warm_lamp_glow').setScale(1.6).setDepth(2121);
    this.add.image(3090, 2290, 'prop_weapon_rack_25d').setScale(1.2).setOrigin(0.5, 0.85).setDepth(2290);
    this.add.image(3280, 2290, 'prop_weapon_rack_25d').setScale(1.2).setOrigin(0.5, 0.85).setDepth(2290);

    // 13. TERRITÓRIO EXTREMO LESTE: Rio Profundo & Ponte Velha (Com Passagem Oculta Debaixo da Ponte!) (3530, 1400)
    this.add
      .image(3530, 1400, 'building_bridge_25d')
      .setScale(1.15)
      .setDepth(3650);

    // 14. Tochas Rústicas ao longo das Estradas Orgânicas da Vila
    [
      { x: 1020, y: 1310 },
      { x: 1580, y: 1310 },
      { x: 2560, y: 1310 },
      { x: 3340, y: 1310 },
      { x: 2010, y: 860 },
      { x: 2110, y: 1810 },
      { x: 1120, y: 2140 },
      { x: 2740, y: 2140 }
    ].forEach((pos) => {
      this.add.image(pos.x, pos.y, 'prop_lamp_25d').setOrigin(0.5, 0.9).setDepth(pos.y);
      this.add.image(pos.x, pos.y - 58, 'warm_lamp_glow').setDepth(pos.y + 1);
    });

    // 15. Rótulos Tipográficos Limpos nos 12 Territórios da Vila
    const subtitles: Record<string, string> = {
      poco_distante: 'Água Rasa (-45% Velocidade)',
      cedros_norte: 'Copa da Árvore Oculta Jogadores',
      casas_perifericas: 'Esconderijo nos Barris [F]',
      milharal: 'Milharal Alto Oculta Jogadores',
      pedras_antigas: 'Aura Rúnica (+22% Velocidade)',
      ponte_madeira: 'Sombra Oculta Sob a Ponte',
      igreja: 'Solo Sagrado (Lobo -38% Velocidade)',
      pastagem: 'Rebanho & Campos Abertos',
      prefeitura: 'Arquivos & Decreto',
      cemiterio: 'Tumbas do Lobo [T] & Brumas',
      ferraria: 'Forja Vulcânica & Armas',
      cedros_sul: 'Mata Fechada do Caçador'
    };

    for (const z of VILLAGE_ZONES) {
      const cx = z.x + z.width / 2;
      const topY = z.y + 26;
      this.add
        .text(cx, topY, z.name.toUpperCase(), {
          fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#f2e8d5',
          stroke: '#090705',
          strokeThickness: 5
        })
        .setOrigin(0.5)
        .setDepth(4100);

      if (subtitles[z.id]) {
        this.add
          .text(cx, topY + 20, subtitles[z.id], {
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '11px',
            fontStyle: 'bold',
            color: '#d99b26',
            stroke: '#090705',
            strokeThickness: 4
          })
          .setOrigin(0.5)
          .setDepth(4100);
      }
    }
  }

  private isTypingInInput(): boolean {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  private setupKeyboardControls() {
    if (!this.input.keyboard) return;

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys(
      {
        W: Phaser.Input.Keyboard.KeyCodes.W,
        A: Phaser.Input.Keyboard.KeyCodes.A,
        S: Phaser.Input.Keyboard.KeyCodes.S,
        D: Phaser.Input.Keyboard.KeyCodes.D,
        B: Phaser.Input.Keyboard.KeyCodes.B,
        E: Phaser.Input.Keyboard.KeyCodes.E,
        F: Phaser.Input.Keyboard.KeyCodes.F,
        T: Phaser.Input.Keyboard.KeyCodes.T,
        R: Phaser.Input.Keyboard.KeyCodes.R,
        Q: Phaser.Input.Keyboard.KeyCodes.Q,
        SPACE: Phaser.Input.Keyboard.KeyCodes.SPACE
      },
      false
    ) as any;

    this.keys.B.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive) return;
      this.socket.emit('barricade_interact', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.onToast(res.message);
      });
    });

    this.keys.T.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive || !me?.isWerewolf) return;
      this.socket.emit('toggle_tomb', (res: any) => {
        if (res?.ok && typeof res.x === 'number' && typeof res.y === 'number') {
          this.predictedX = res.x;
          this.predictedY = res.y;
        }
        if (res?.message) this.onToast(res.message);
      });
    });

    this.keys.F.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive) return;
      this.socket.emit('toggle_barrel', (res: any) => {
        if (res?.ok && typeof res.x === 'number' && typeof res.y === 'number') {
          this.predictedX = res.x;
          this.predictedY = res.y;
        }
        if (res?.message) this.onToast(res.message);
      });
    });

    this.keys.E.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive) return;
      if (this.snapshot?.phase === 'LOBBY') {
        const distToWardrobe = Math.hypot(
          LOBBY_WARDROBE_POS.x - this.predictedX,
          LOBBY_WARDROBE_POS.y - this.predictedY
        );
        if (distToWardrobe <= LOBBY_WARDROBE_INTERACT_RADIUS + 35) {
          document.getElementById('btn-open-classes')?.click();
          return;
        }
      }
      this.socket.emit('mission_interact', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.onToast(res.message);
      });
    });

    this.keys.SPACE.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive) return;
      this.socket.emit('use_ability', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.onToast(res.message);
      });
    });

    this.keys.R.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive) return;
      this.socket.emit('report_or_bell', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.onToast(res.message);
      });
    });

    this.keys.Q.on('down', () => {
      if (this.isTypingInInput()) return;
      const me = this.snapshot?.players.find((p) => p.id === this.socket.id);
      if (!me?.isAlive) return;
      this.socket.emit('werewolf_transform', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.onToast(res.message);
      });
    });
  }

  update(time: number, _delta: number) {
    const nowPerf = performance.now();
    const realDeltaMs = Math.max(8, Math.min(80, nowPerf - this.lastMoveWallClock));
    this.lastMoveWallClock = nowPerf;

    if (!this.snapshot) return;

    const myPlayer = this.snapshot.players.find((p) => p.id === this.socket.id);
    if (myPlayer) {
      this.handleClientSidePredictedMove(myPlayer, time, realDeltaMs);
      this.cameras.main.centerOn(this.predictedX, this.predictedY);
    }

    this.syncEntities25D(myPlayer || null, realDeltaMs);
    this.updateLightweightLighting(myPlayer || null);
  }

  private handleClientSidePredictedMove(myPlayer: PlayerState, time: number, realDeltaMs: number) {
    // Permite andar livremente com o boneco também no LOBBY (sala de espera estilo Among Us)!
    if (
      this.snapshot?.phase !== 'LOBBY' &&
      this.snapshot?.phase !== 'PHASE_1_HUNT' &&
      this.snapshot?.phase !== 'PHASE_3_BLOOD_MOON'
    ) {
      return;
    }

    const now = Date.now();
    // Enquanto estiver atordoado, escondido ou removendo uma Barricada de Madeira (4s incancelável!), não pode andar!
    if (
      myPlayer.isAlive &&
      (now < myPlayer.isStunnedEnd ||
        myPlayer.hiddenInBarrelId ||
        myPlayer.hiddenInTombId ||
        myPlayer.removingBarricadeId)
    ) {
      return;
    }

    let dx = this.joystickDx;
    let dy = this.joystickDy;

    if (this.keys && dx === 0 && dy === 0) {
      if (this.keys.A.isDown || this.cursors.left.isDown) dx -= 1;
      if (this.keys.D.isDown || this.cursors.right.isDown) dx += 1;
      if (this.keys.W.isDown || this.cursors.up.isDown) dy -= 1;
      if (this.keys.S.isDown || this.cursors.down.isDown) dy += 1;
    }

    const len = Math.hypot(dx, dy);
    if (len > 0.04) {
      const normX = dx / Math.max(1, len);
      const normY = dy / Math.max(1, len);

      let speedPxPerSec = myPlayer.isAlive ? 480 : 560;
      if (myPlayer.isAlive && now < myPlayer.hasSpeedBuffEnd) speedPxPerSec *= 1.42;
      if (myPlayer.isAlive && now < (myPlayer.guiltSlowEnd || 0)) speedPxPerSec *= 0.72; // Penalidade por votar em inocente
      if (myPlayer.isAlive && myPlayer.isWerewolf && myPlayer.isTransformed) {
        speedPxPerSec *= this.snapshot.phase === 'PHASE_3_BLOOD_MOON' ? 1.28 : 1.16;
      }

      // MECÂNICA DO TERRITÓRIO 1: Solo Sagrado da Igreja deixa o Lobisomem 38% mais devagar!
      if (
        myPlayer.isAlive &&
        myPlayer.isWerewolf &&
        isPointInChurchSacredGround(this.predictedX, this.predictedY)
      ) {
        speedPxPerSec *= 0.62;
      }

      // MECÂNICA DO TERRITÓRIO 2: Lago Raso do Poço reduz velocidade em 45% (caminhando na água rasa!)
      if (myPlayer.isAlive && isPointInShallowLake(this.predictedX, this.predictedY)) {
        speedPxPerSec *= 0.55;
      }
      // MECÂNICA DO TERRITÓRIO 3: Círculo de Menires Rúnicos aumenta velocidade em +22%!
      else if (myPlayer.isAlive && isPointInRunicCircle(this.predictedX, this.predictedY)) {
        speedPxPerSec *= 1.22;
      }

      const step = (speedPxPerSec * realDeltaMs) / 1000;
      const rawX = this.predictedX + normX * step;
      const rawY = this.predictedY + normY * step;

      if (myPlayer.isAlive) {
        // O Lobisomem (myPlayer.isWerewolf) pode entrar na Floresta Densa fora das trilhas para se esconder!
        const resolved = resolveMapCollisions(
          this.predictedX,
          this.predictedY,
          rawX,
          rawY,
          this.snapshot.barricades,
          myPlayer.isWerewolf
        );
        if (this.snapshot.phase === 'LOBBY') {
          const fenced = resolveLobbyFenceCollisions(
            this.predictedX,
            this.predictedY,
            resolved.x,
            resolved.y
          );
          this.predictedX = fenced.x;
          this.predictedY = fenced.y;
        } else {
          this.predictedX = resolved.x;
          this.predictedY = resolved.y;
        }
      } else {
        this.predictedX = Math.max(60, Math.min(MAP_WIDTH - 60, rawX));
        this.predictedY = Math.max(60, Math.min(MAP_HEIGHT - 60, rawY));
      }

      myPlayer.x = Math.round(this.predictedX);
      myPlayer.y = Math.round(this.predictedY);

      const angle = Math.atan2(normY, normX);
      myPlayer.facingAngle = angle;

      if (time - this.lastNetSyncTime >= 38) {
        this.lastNetSyncTime = time;
        this.socket.emit('move', {
          dx: normX,
          dy: normY,
          angle,
          x: myPlayer.x,
          y: myPlayer.y
        });
      }
    }
  }

  private syncEntities25D(myPlayer: PlayerState | null, delta: number) {
    if (!this.snapshot) return;
    this.overlayGraphics.clear();
    const now = Date.now();

    // 1. Halo no Armário de Personagens + Cercas Físicas de Madeira nas 4 Passagens da Catedral durante o LOBBY!
    const isLobbyPhase = this.snapshot.phase === 'LOBBY';
    for (const fence of LOBBY_PASSAGE_FENCES) {
      let spr = this.lobbyFenceSprites.get(fence.id);
      const texKey =
        fence.orientation === 'HORIZONTAL' ? 'prop_lobby_fence_h_25d' : 'prop_lobby_fence_v_25d';
      if (!spr) {
        spr = this.add
          .image(fence.x, fence.y, texKey)
          .setOrigin(0.5, 0.72)
          .setDepth(fence.y);
        this.lobbyFenceSprites.set(fence.id, spr);
      }
      spr.setVisible(isLobbyPhase);
    }

    if (myPlayer && myPlayer.isAlive && isLobbyPhase) {
      const distW = Math.hypot(
        LOBBY_WARDROBE_POS.x - this.predictedX,
        LOBBY_WARDROBE_POS.y - this.predictedY
      );
      const pulseAlpha = distW <= LOBBY_WARDROBE_INTERACT_RADIUS ? 0.95 : 0.45;
      this.overlayGraphics.lineStyle(3, 0xd99b26, pulseAlpha);
      this.overlayGraphics.strokeEllipse(
        LOBBY_WARDROBE_POS.x,
        LOBBY_WARDROBE_POS.y - 6,
        74,
        32
      );
    }
    if (myPlayer && myPlayer.isAlive && this.snapshot.phase === 'PHASE_1_HUNT' && !myPlayer.abilityUnlocked) {
      const cls = CLASSES_BY_ID[myPlayer.classId];
      const targetZone = VILLAGE_ZONES.find((z) => z.id === cls.missionZone);
      if (targetZone) {
        const tx = targetZone.x + targetZone.width / 2;
        const ty = targetZone.y + targetZone.height / 2;
        const dist = Math.hypot(tx - this.predictedX, ty - this.predictedY);

        if (isPointInZone(this.predictedX, this.predictedY, targetZone)) {
          this.overlayGraphics.lineStyle(3.5, 0xd99b26, 0.85);
          this.overlayGraphics.strokeCircle(tx, ty, 120);
        } else if (dist > 160) {
          const angle = Math.atan2(ty - this.predictedY, tx - this.predictedX);
          const arrowX = this.predictedX + Math.cos(angle) * 60;
          const arrowY = this.predictedY - 24 + Math.sin(angle) * 60;

          this.overlayGraphics.fillStyle(0xd99b26, 0.95);
          this.overlayGraphics.lineStyle(2.5, 0x090d16, 1);
          this.overlayGraphics.beginPath();
          this.overlayGraphics.moveTo(
            arrowX + Math.cos(angle) * 12,
            arrowY + Math.sin(angle) * 12
          );
          this.overlayGraphics.lineTo(
            arrowX + Math.cos(angle + 2.4) * 10,
            arrowY + Math.sin(angle + 2.4) * 10
          );
          this.overlayGraphics.lineTo(
            arrowX + Math.cos(angle - 2.4) * 10,
            arrowY + Math.sin(angle - 2.4) * 10
          );
          this.overlayGraphics.closePath();
          this.overlayGraphics.fillPath();
          this.overlayGraphics.strokePath();
        }
      }
    }

    // 1.4. Durante o Eclipse Lunar, o Sino da Igreja fica FECHADO (grade de proteção e tint escuro)
    if (this.churchBellSprite) {
      if (this.snapshot.phase === 'PHASE_1_HUNT' && this.snapshot.eclipseActive) {
        this.churchBellSprite.setTint(0x52525b);
        this.overlayGraphics.lineStyle(3, 0x991b1b, 0.9);
        this.overlayGraphics.strokeCircle(CHURCH_CENTER.x, CHURCH_CENTER.y + 4, 42);
        this.overlayGraphics.lineBetween(
          CHURCH_CENTER.x - 28,
          CHURCH_CENTER.y - 24,
          CHURCH_CENTER.x + 28,
          CHURCH_CENTER.y + 32
        );
        this.overlayGraphics.lineBetween(
          CHURCH_CENTER.x + 28,
          CHURCH_CENTER.y - 24,
          CHURCH_CENTER.x - 28,
          CHURCH_CENTER.y + 32
        );
      } else {
        this.churchBellSprite.clearTint();
      }
    }

    // 1.5. Atualiza o Barril de Esconderijo da Vila das Cabanas
    for (const hb of HIDING_BARRELS) {
      const spr = this.hidingBarrelSprites.get(hb.id);
      if (!spr) continue;
      const amIHiddenHere = myPlayer?.isAlive && myPlayer?.hiddenInBarrelId === hb.id;
      const alreadyUsedByMe = Boolean(myPlayer?.usedBarrelIds?.includes(hb.id)) && !amIHiddenHere;
      spr.setTexture(amIHiddenHere ? 'prop_hiding_barrel_peek_25d' : 'prop_hiding_barrel_25d');
      spr.setAlpha(alreadyUsedByMe ? 0.65 : 1);

      const distToBarrel = Math.hypot(hb.x - this.predictedX, hb.y - this.predictedY);
      if (myPlayer?.isAlive && !alreadyUsedByMe && (amIHiddenHere || distToBarrel <= BARREL_INTERACT_RADIUS)) {
        this.overlayGraphics.lineStyle(2.5, amIHiddenHere ? 0x40916c : 0xd99b26, 0.88);
        this.overlayGraphics.strokeEllipse(hb.x, hb.y - 4, 54, 22);
      }
    }

    // 1.6. Atualiza as Tumbas do Cemitério (Mostra olhos vermelhos do Lobo se VOCÊ estiver escondido nela e aro carmesim para o Lobisomem próximo!)
    for (const tomb of WEREWOLF_TOMBS) {
      const spr = this.werewolfTombSprites.get(tomb.id);
      if (!spr) continue;
      const amIWolfInTomb =
        myPlayer?.isAlive && myPlayer?.isWerewolf && myPlayer?.hiddenInTombId === tomb.id;
      spr.setTexture(amIWolfInTomb ? 'prop_wolf_tomb_peek_25d' : 'prop_wolf_tomb_25d');

      const distToTomb = Math.hypot(tomb.x - this.predictedX, tomb.y - this.predictedY);
      if (
        myPlayer?.isAlive &&
        myPlayer?.isWerewolf &&
        (amIWolfInTomb || distToTomb <= TOMB_INTERACT_RADIUS)
      ) {
        this.overlayGraphics.lineStyle(3, amIWolfInTomb ? 0xef4444 : 0xd99b26, 0.9);
        this.overlayGraphics.strokeRoundedRect(tomb.x - 46, tomb.y - 46, 92, 52, 8);
      }
    }

    // 1.7. Renderiza Barricadas de Madeira entre os Territórios + Barra de Progresso de 4 Segundos Incancelável!
    for (const bar of this.snapshot.barricades || []) {
      let spr = this.barricadeSprites.get(bar.slotId);
      const texKey =
        bar.orientation === 'HORIZONTAL' ? 'prop_barricade_h_25d' : 'prop_barricade_v_25d';
      if (!spr) {
        spr = this.add
          .image(bar.x, bar.y, texKey)
          .setOrigin(0.5, 0.65)
          .setDepth(bar.y);
        this.barricadeSprites.set(bar.slotId, spr);
      }
      spr.setVisible(bar.active);

      const distToBar = Math.hypot(bar.x - this.predictedX, bar.y - this.predictedY);

      // Se a barricada está ativa e alguém está removendo (4 segundos sem poder cancelar!), desenha a barra de progresso acima dela!
      if (bar.active && bar.removingByPlayerId && bar.removeEndsAt > now) {
        const elapsed = Math.max(0, now - bar.removeStartedAt);
        const pct = Math.min(1, elapsed / BARRICADE_REMOVE_DURATION_MS);

        this.overlayGraphics.fillStyle(0x0b0806, 0.92);
        this.overlayGraphics.fillRoundedRect(bar.x - 58, bar.y - 68, 116, 16, 5);
        this.overlayGraphics.lineStyle(2, 0xd99b26, 1);
        this.overlayGraphics.strokeRoundedRect(bar.x - 58, bar.y - 68, 116, 16, 5);

        this.overlayGraphics.fillStyle(0x40916c, 1);
        this.overlayGraphics.fillRoundedRect(bar.x - 55, bar.y - 65, 110 * pct, 10, 3);
      } else if (
        myPlayer?.isAlive &&
        distToBar <= BARRICADE_INTERACT_RADIUS &&
        (bar.active || myPlayer.isWerewolf)
      ) {
        // Destaca o ponto no chão para o Lobisomem bloquear com madeira ou para qualquer jogador remover
        const w = bar.orientation === 'HORIZONTAL' ? 160 : 72;
        const h = bar.orientation === 'HORIZONTAL' ? 62 : 160;
        this.overlayGraphics.lineStyle(2.5, bar.active ? 0xef4444 : 0xd99b26, 0.8);
        this.overlayGraphics.strokeRoundedRect(bar.x - w / 2, bar.y - h / 2, w, h, 8);
      }
    }

    // 2. Totens Rúnicos
    for (const totem of this.snapshot.totems) {
      let spr = this.totemSprites.get(totem.id);
      const texKey = totem.destroyed ? 'prop_totem_broken_25d' : 'prop_totem_active_25d';
      if (!spr) {
        spr = this.add
          .image(totem.x, totem.y, texKey)
          .setOrigin(0.5, 0.85)
          .setDepth(totem.y);
        this.totemSprites.set(totem.id, spr);
      } else {
        spr.setTexture(texKey);
      }
    }

    // 3. Armadilhas
    const activeTrapIds = new Set<string>();
    for (const trap of this.snapshot.traps) {
      activeTrapIds.add(trap.id);
      let spr = this.trapSprites.get(trap.id);
      if (!spr) {
        spr = this.add.image(trap.x, trap.y, 'prop_trap_25d').setDepth(trap.y - 10);
        this.trapSprites.set(trap.id, spr);
      }
      spr.setAlpha(trap.triggered ? 0.35 : 0.95);
    }
    for (const [id, spr] of this.trapSprites.entries()) {
      if (!activeTrapIds.has(id)) {
        spr.destroy();
        this.trapSprites.delete(id);
      }
    }

    // 3.5. Relíquia das Armas do Caçador no Chão (Quando o Caçador cai, qualquer morador pode pegar ou herda em 10s!)
    if (this.snapshot.hunterRelic) {
      const relic = this.snapshot.hunterRelic;
      const remSec = Math.max(0, Math.ceil((relic.autoAssignAtMs - now) / 1000));
      if (!this.hunterRelicSprite) {
        this.hunterRelicSprite = this.add
          .image(relic.x, relic.y, 'prop_hunter_relic_25d')
          .setOrigin(0.5, 0.78)
          .setDepth(relic.y + 4);
      } else {
        this.hunterRelicSprite.setPosition(relic.x, relic.y);
        this.hunterRelicSprite.setDepth(relic.y + 4);
      }
      if (!this.hunterRelicLabel) {
        this.hunterRelicLabel = this.add
          .text(relic.x, relic.y - 46, '', {
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#fef08a',
            stroke: '#060907',
            strokeThickness: 4.5
          })
          .setOrigin(0.5)
          .setDepth(4360);
      }
      this.hunterRelicLabel.setPosition(relic.x, relic.y - 46);
      this.hunterRelicLabel.setText(`ARMAS DO CAÇADOR (Pegue ou Sucessão em ${remSec}s)`);

      const pulseR = 44 + Math.sin(now * 0.012) * 8;
      this.overlayGraphics.lineStyle(3, 0xe9c46a, 0.92);
      this.overlayGraphics.strokeCircle(relic.x, relic.y - 8, pulseR);
    } else {
      if (this.hunterRelicSprite) {
        this.hunterRelicSprite.destroy();
        this.hunterRelicSprite = null;
      }
      if (this.hunterRelicLabel) {
        this.hunterRelicLabel.destroy();
        this.hunterRelicLabel = null;
      }
    }

    // 4. Túmulos de Terra com Cruz onde o Lobisomem abateu um jogador + VFX de Garras
    const activeCorpseIds = new Set<string>();
    for (const corpse of this.snapshot.corpses) {
      activeCorpseIds.add(corpse.id);
      if (!this.corpseSprites.has(corpse.id)) {
        const spr = this.add
          .image(corpse.x, corpse.y, 'prop_dirt_grave_cross_25d')
          .setOrigin(0.5, 0.82)
          .setDepth(corpse.y);
        this.corpseSprites.set(corpse.id, spr);

        const slash = this.add
          .image(corpse.x, corpse.y - 16, 'vfx_claw_slash_25d')
          .setDepth(4450)
          .setScale(0.6);
        this.tweens.add({
          targets: slash,
          scale: 1.35,
          alpha: 0,
          duration: 520,
          ease: 'Cubic.easeOut',
          onComplete: () => slash.destroy()
        });
        this.cameras.main.shake(220, 0.009);
      }
    }
    for (const [id, spr] of this.corpseSprites.entries()) {
      if (!activeCorpseIds.has(id)) {
        spr.destroy();
        this.corpseSprites.delete(id);
      }
    }

    // 5. Círculo da Lua de Sangue
    if (this.snapshot.phase === 'PHASE_3_BLOOD_MOON') {
      this.overlayGraphics.lineStyle(10, 0xdc2626, 0.85);
      this.overlayGraphics.strokeCircle(
        CHURCH_CENTER.x,
        CHURCH_CENTER.y,
        this.snapshot.siegeRadius
      );
      this.overlayGraphics.lineStyle(3, 0xfef08a, 0.95);
      this.overlayGraphics.strokeCircle(
        CHURCH_CENTER.x,
        CHURCH_CENTER.y,
        this.snapshot.siegeRadius - 7
      );

      const hpPct = Math.max(0, this.snapshot.churchBellHp / this.snapshot.churchBellMaxHp);
      this.overlayGraphics.fillStyle(0x0f172a, 0.92);
      this.overlayGraphics.fillRoundedRect(CHURCH_CENTER.x - 48, CHURCH_CENTER.y - 78, 96, 12, 4);
      this.overlayGraphics.fillStyle(0xef4444, 1);
      this.overlayGraphics.fillRoundedRect(
        CHURCH_CENTER.x - 46,
        CHURCH_CENTER.y - 76,
        92 * hpPct,
        8,
        3
      );
    }

    // 6. Personagens 2.5D Animados
    const activePlayerIds = new Set<string>();
    let transformedWolfMovingInCorn = false;
    let wolfCornX = 700;
    let wolfCornY = 2190;

    for (const p of this.snapshot.players) {
      activePlayerIds.add(p.id);
      const isSelf = myPlayer?.id === p.id;
      const isInvisible = now < p.isInvisibleEnd && now >= p.isRevealedEnd;

      let node = this.playerNodes.get(p.id);
      if (!node) {
        const selectionRing = this.add
          .ellipse(p.x, p.y, 42, 16)
          .setStrokeStyle(2.5, 0xd99b26, 0.85)
          .setDepth(p.y - 2);
        const shieldRing = this.add
          .ellipse(p.x, p.y - 24, 58, 74)
          .setStrokeStyle(3, 0x38bdf8, 0.9)
          .setDepth(p.y + 1)
          .setVisible(false);
        const sprite = this.add
          .sprite(p.x, p.y, `hero_${p.classId}_0`)
          .setOrigin(0.5, 0.88)
          .setDepth(p.y);

        const nameTag = this.add
          .text(p.x, p.y - 76, p.name, {
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '13px',
            fontStyle: 'bold',
            color: '#f2e8d5',
            stroke: '#060907',
            strokeThickness: 4.5
          })
          .setOrigin(0.5)
          .setDepth(4300);

        const speechBubble = this.add
          .text(p.x, p.y - 102, '', {
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
            fontSize: '12px',
            fontStyle: 'bold',
            color: '#fef08a',
            backgroundColor: 'rgba(14, 18, 15, 0.92)',
            padding: { x: 8, y: 4 }
          })
          .setOrigin(0.5)
          .setDepth(4350)
          .setVisible(false);

        node = {
          sprite,
          selectionRing,
          shieldRing,
          nameTag,
          speechBubble,
          targetX: p.x,
          targetY: p.y,
          animTimer: 0,
          animFrame: 0,
          facingLeft: false,
          wasAbilityUnlocked: p.abilityUnlocked,
          lastRustleX: p.x,
          lastRustleY: p.y
        };
        this.playerNodes.set(p.id, node);
      }

      // Dispara a Animação de Missão Concluída (Explosão de Anel Dourado + Salto + Banner Flutuante) no instante em que a missão atinge 100%!
      if (!node.wasAbilityUnlocked && p.abilityUnlocked) {
        this.playMissionCompleteAnimation(
          isSelf ? this.predictedX : p.x,
          isSelf ? this.predictedY : p.y,
          CLASSES_BY_ID[p.classId].abilityName,
          isSelf
        );
      }
      node.wasAbilityUnlocked = p.abilityUnlocked;

      // Verifica se o jogador está escondido dentro de um Barril, sob a Copa da Grande Árvore Ancestral,
      // no Milharal Alto, no Bosque de Caça do Sul, embaixo da Ponte do Rio OU se é o Lobisomem dentro da Floresta Densa!
      const checkX = isSelf ? this.predictedX : p.x;
      const checkY = isSelf ? this.predictedY : p.y;

      // REGRA DO MILHARAL: Moradores e o Lobo em forma humana NÃO mexem o milharal!
      // APENAS o Lobisomem TRANSFORMADO (p.isTransformed) mexendo-se dentro do milharal faz a plantação balançar!
      const rustleMovedDist = Math.hypot(checkX - node.lastRustleX, checkY - node.lastRustleY);
      node.lastRustleX = checkX;
      node.lastRustleY = checkY;

      if (p.isAlive && p.isTransformed && isPointInCornfield(checkX, checkY)) {
        if (rustleMovedDist > 0.35) {
          transformedWolfMovingInCorn = true;
          wolfCornX = checkX;
          wolfCornY = checkY;
        }
      }
      const inDenseForest = !isOnPathOrClearing(checkX, checkY);
      const hiddenByLandmark = isPlayerHiddenByEnvironment(checkX, checkY);

      const hideFromViewer =
        Boolean(p.hiddenInBarrelId) ||
        Boolean(p.hiddenInTombId) ||
        hiddenByLandmark ||
        (inDenseForest && !isSelf && myPlayer?.isAlive) ||
        (isInvisible && !isSelf && myPlayer?.isAlive) ||
        (!p.isAlive && myPlayer?.isAlive && this.snapshot.phase !== 'POST_GAME');

      if (hideFromViewer) {
        node.sprite.setVisible(false);
        node.selectionRing.setVisible(false);
        node.shieldRing.setVisible(false);
        node.nameTag.setVisible(false);
        node.speechBubble.setVisible(false);
        continue;
      }

      const destX = isSelf ? this.predictedX : p.x;
      const destY = isSelf ? this.predictedY : p.y;

      const renderX = isSelf
        ? destX
        : Phaser.Math.Linear(node.sprite.x, destX, Math.min(1, delta * 0.018));
      const renderY = isSelf
        ? destY
        : Phaser.Math.Linear(node.sprite.y, destY, Math.min(1, delta * 0.018));

      const frameDx = renderX - node.sprite.x;
      const frameDy = renderY - node.sprite.y;
      const movedThisFrame = Math.hypot(frameDx, frameDy);

      if (Math.abs(frameDx) > 0.15) {
        node.facingLeft = frameDx < 0;
      }

      if (movedThisFrame > 0.25 || p.isPerformingMission) {
        node.animTimer += delta;
        const frameDuration = p.isPerformingMission ? 130 : 105;
        if (node.animTimer >= frameDuration) {
          node.animTimer = 0;
          node.animFrame = node.animFrame === 1 ? 2 : 1;
        }
      } else {
        node.animFrame = 0;
        node.animTimer = 0;
      }

      const texKey = p.isTransformed
        ? `werewolf_25d_${node.animFrame}`
        : `hero_${p.classId}_${node.animFrame}`;

      // Pequeno movimento rítmico de trabalho na vertical enquanto executa a missão
      const workBobY = p.isPerformingMission ? Math.sin(now * 0.018) * 3 : 0;

      node.sprite.setTexture(texKey);
      node.sprite.setPosition(renderX, renderY + workBobY);
      node.sprite.setFlipX(node.facingLeft);
      node.sprite.setDepth(renderY);
      node.sprite.setAlpha(
        !p.isAlive ? 0.42 : isInvisible ? 0.45 : inDenseForest && isSelf ? 0.62 : 1
      );
      node.sprite.setVisible(true);

      // Enquanto realiza a missão (isPerformingMission):
      // 1. Cúpula Dourada Protetora (Lobisomem NÃO pode matar durante a missão!)
      // 2. Barra de carregamento automático com o tempo específico daquela missão acima do personagem
      if (p.isAlive && p.isPerformingMission) {
        const pulse = 0.72 + Math.sin(now * 0.01) * 0.2;
        this.overlayGraphics.lineStyle(3, 0xe9c46a, pulse);
        this.overlayGraphics.strokeEllipse(renderX, renderY - 26, 66, 82);
        this.overlayGraphics.fillStyle(0xe9c46a, 0.12);
        this.overlayGraphics.fillEllipse(renderX, renderY - 26, 66, 82);

        const pct = Math.max(0, Math.min(1, p.missionProgress / 100));
        const barW = 78;
        const barH = 11;
        const barX = renderX - barW / 2;
        const barY = renderY - 102;

        this.overlayGraphics.fillStyle(0x080c09, 0.92);
        this.overlayGraphics.fillRoundedRect(barX, barY, barW, barH, 4);
        this.overlayGraphics.lineStyle(1.5, 0xd99b26, 0.95);
        this.overlayGraphics.strokeRoundedRect(barX, barY, barW, barH, 4);

        this.overlayGraphics.fillStyle(0x52b788, 1);
        this.overlayGraphics.fillRoundedRect(barX + 2, barY + 2, (barW - 4) * pct, barH - 4, 3);
      }

      // Se o jogador estiver caminhando dentro da água do Lago Raso do Poço, desenha ondulações de água nos pés!
      if (p.isAlive && isPointInShallowLake(renderX, renderY)) {
        this.overlayGraphics.lineStyle(2.5, 0x7dd3fc, 0.78);
        const rippleR = 20 + Math.sin(now * 0.012) * 5;
        this.overlayGraphics.strokeEllipse(renderX, renderY - 2, rippleR * 2, rippleR * 0.85);
      }

      node.selectionRing.setPosition(renderX, renderY - 2);
      node.selectionRing.setDepth(renderY - 1);
      node.selectionRing.setVisible(isSelf);

      node.shieldRing.setPosition(renderX, renderY - 30);
      node.shieldRing.setDepth(renderY + 1);
      node.shieldRing.setVisible(p.hasBlessingShield);

      const topOffset = p.isTransformed ? 90 : 76;
      const stunLabel = now < p.isStunnedEnd ? ' (Atordoado)' : '';
      const guiltLabel = now < (p.guiltSlowEnd || 0) ? ' [Penalizado]' : '';
      const missionTag = p.isPerformingMission ? ` [Missão ${Math.floor(p.missionProgress)}%]` : '';
      const reconLeftSec =
        p.isConnected === false && p.reconnectDeadlineMs
          ? Math.max(0, Math.ceil((p.reconnectDeadlineMs - now) / 1000))
          : 0;
      const reconTag = reconLeftSec > 0 ? ` [Reconectando ${reconLeftSec}s]` : '';
      node.nameTag.setText(`${p.name}${stunLabel}${guiltLabel}${missionTag}${reconTag}`);
      node.nameTag.setPosition(renderX, renderY - topOffset);
      node.nameTag.setColor(
        p.isTransformed
          ? '#ef4444'
          : reconLeftSec > 0
            ? '#fb923c'
            : p.isPerformingMission
              ? '#e9c46a'
              : isSelf
                ? '#f3d5b5'
                : '#f2e8d5'
      );
      node.nameTag.setVisible(true);

      // Balão de conversa sobre a cabeça do boneco na Praça da Catedral durante o LOBBY!
      if (this.snapshot.phase === 'LOBBY' && this.snapshot.lobbyChatMessages?.length > 0) {
        const recentMsg = [...this.snapshot.lobbyChatMessages]
          .reverse()
          .find((m) => m.senderId === p.id && now - m.timestamp <= 7500);
        if (recentMsg) {
          const bubbleText =
            recentMsg.text.length > 44 ? `${recentMsg.text.slice(0, 42)}...` : recentMsg.text;
          node.speechBubble.setText(`"${bubbleText}"`);
          node.speechBubble.setPosition(renderX, renderY - topOffset - 24);
          node.speechBubble.setVisible(true);
        } else {
          node.speechBubble.setVisible(false);
        }
      } else {
        node.speechBubble.setVisible(false);
      }
    }

    for (const [id, node] of this.playerNodes.entries()) {
      if (!activePlayerIds.has(id)) {
        node.sprite.destroy();
        node.selectionRing.destroy();
        node.shieldRing.destroy();
        node.nameTag.destroy();
        node.speechBubble.destroy();
        this.playerNodes.delete(id);
      }
    }

    // Atualiza a agitação do Milharal: SOMENTE se o Lobisomem TRANSFORMADO estiver se movendo lá dentro!
    if (this.cornfieldChunkSprite) {
      if (transformedWolfMovingInCorn) {
        const shakeX = Math.sin(now * 0.045) * 4.5;
        const shakeY = Math.cos(now * 0.038) * 2.5;
        const tiltDeg = Math.sin(now * 0.04) * 0.9;
        this.cornfieldChunkSprite.setPosition(700 + shakeX, 2190 + shakeY);
        this.cornfieldChunkSprite.setAngle(tiltDeg);

        // Ondas de folhas e pés de milho chacoalhando exatamente onde a fera transformada está passando
        const rustleRadius = 32 + Math.sin(now * 0.025) * 10;
        this.overlayGraphics.lineStyle(3, 0xeab308, 0.72);
        this.overlayGraphics.strokeEllipse(
          wolfCornX,
          wolfCornY - 18,
          rustleRadius * 1.9,
          rustleRadius * 1.15
        );

        if (now - this.lastCornRustleSpawnAt > 150) {
          this.lastCornRustleSpawnAt = now;
          const stalk = this.add
            .image(
              wolfCornX + (Math.random() - 0.5) * 34,
              wolfCornY + (Math.random() - 0.5) * 20,
              'prop_corn_25d'
            )
            .setOrigin(0.5, 0.9)
            .setDepth(3720);
          this.tweens.add({
            targets: stalk,
            angle: { from: -14, to: 14 },
            yoyo: true,
            repeat: 1,
            alpha: { from: 0.95, to: 0 },
            duration: 210,
            onComplete: () => stalk.destroy()
          });
        }
      } else {
        this.cornfieldChunkSprite.setPosition(700, 2190);
        this.cornfieldChunkSprite.setAngle(0);
      }
    }
  }

  /**
   * Animação visual de Missão Concluída (100%):
   * Ondas douradas expansivas, faíscas ascendentes e texto flutuante celebrando o desbloqueio da habilidade!
   */
  private playMissionCompleteAnimation(
    x: number,
    y: number,
    abilityName: string,
    isSelf: boolean
  ) {
    const ring1 = this.add
      .ellipse(x, y - 18, 36, 20)
      .setStrokeStyle(3.5, 0xe9c46a, 1)
      .setDepth(4460);
    const ring2 = this.add
      .ellipse(x, y - 18, 24, 14)
      .setStrokeStyle(2.5, 0x52b788, 0.95)
      .setDepth(4460);

    this.tweens.add({
      targets: ring1,
      scaleX: 3.6,
      scaleY: 3.2,
      alpha: 0,
      duration: 720,
      ease: 'Cubic.easeOut',
      onComplete: () => ring1.destroy()
    });

    this.tweens.add({
      targets: ring2,
      scaleX: 2.8,
      scaleY: 2.5,
      alpha: 0,
      delay: 90,
      duration: 680,
      ease: 'Cubic.easeOut',
      onComplete: () => ring2.destroy()
    });

    // 8 partículas luminosas subindo ao redor do personagem
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const spark = this.add
        .circle(x + Math.cos(angle) * 18, y - 20 + Math.sin(angle) * 10, 4, 0xfef08a, 1)
        .setDepth(4465);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * 58,
        y: y - 62 + Math.sin(angle) * 24,
        alpha: 0,
        scale: 0.3,
        duration: 650,
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy()
      });
    }

    const bannerText = isSelf
      ? `MISSÃO CONCLUÍDA! [${abilityName.toUpperCase()}] LIBERADA`
      : `MISSÃO CONCLUÍDA!`;
    const floatBanner = this.add
      .text(x, y - 96, bannerText, {
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: isSelf ? '14px' : '12px',
        fontStyle: 'bold',
        color: '#fef08a',
        stroke: '#060907',
        strokeThickness: 5
      })
      .setOrigin(0.5)
      .setDepth(4470);

    this.tweens.add({
      targets: floatBanner,
      y: y - 148,
      alpha: 0,
      duration: 1650,
      ease: 'Cubic.easeOut',
      onComplete: () => floatBanner.destroy()
    });

    if (isSelf) {
      this.onToast(`Missão concluída! Habilidade [${abilityName}] liberada (+120 XP)!`);
    }
  }

  private updateLightweightLighting(myPlayer: PlayerState | null) {
    if (!this.visionVignette || !this.snapshot) return;

    if (myPlayer && !myPlayer.isAlive) {
      this.visionVignette.setAlpha(0.2);
      return;
    }

    const now = Date.now();
    const hasClarity = myPlayer ? now < myPlayer.hasClarityBuffEnd : false;
    const isEclipse = this.snapshot.eclipseActive && !hasClarity;

    this.updateVignetteSize(this.scale.width, this.scale.height, isEclipse);

    if (this.snapshot.phase === 'PHASE_3_BLOOD_MOON') {
      this.visionVignette.setTint(0xff6b6b);
    } else {
      this.visionVignette.clearTint();
    }
  }
}
