import { Server } from 'socket.io';
import { CLASSES_BY_ID, CLASSES_LIST } from '../shared/classesData';
import {
  BARRICADE_INTERACT_RADIUS,
  BARRICADE_REMOVE_DURATION_MS,
  BARRICADE_SLOTS,
  BARREL_INTERACT_RADIUS,
  BELL_INTERACT_RADIUS,
  CHURCH_CENTER,
  HIDING_BARRELS,
  INITIAL_RUNIC_TOTEMS,
  MAP_HEIGHT,
  MAP_WIDTH,
  RIVER_LEFT_BANK,
  TOMB_INTERACT_RADIUS,
  VILLAGE_ZONES,
  WEREWOLF_TOMBS,
  isPlayerInCover,
  isPointInChurchSacredGround,
  isPointInRunicCircle,
  isPointInShallowLake,
  isPointInZone,
  resolveMapCollisions
} from '../shared/mapData';
import { XP_REWARDS, evaluateVictoryWheelAngle } from '../shared/progressionData';
import { sanitizeTribunalChatMessage } from '../shared/profanityFilter';
import {
  BarricadeEntity,
  ClassId,
  CorpseEntity,
  GamePhase,
  PlayerState,
  TotemPoint,
  TrapEntity,
  TribunalChatMessage,
  TribunalState,
  WorldSnapshot
} from '../shared/types';

interface PositionLog {
  playerId: string;
  playerName: string;
  x: number;
  y: number;
  timestamp: number;
}

export class GameRoom {
  public roomId: string;
  private io: Server;
  private phase: GamePhase = 'LOBBY';
  private phaseStartedAt: number = Date.now();
  private phaseDurationSec: number = 240;

  private eclipseActive: boolean = false;
  private eclipseCycleTimerMs: number = 0;

  private siegeRadius: number = 1500;
  private churchBellHp: number = 500;
  private readonly churchBellMaxHp: number = 500;

  private players: Map<string, PlayerState> = new Map();
  private totems: TotemPoint[] = [];
  private traps: TrapEntity[] = [];
  private corpses: CorpseEntity[] = [];
  private barricades: BarricadeEntity[] = [];
  private positionHistory: PositionLog[] = [];

  private tribunal: TribunalState | null = null;
  private turn1Votes: Map<string, string> = new Map(); // voterId -> targetId
  private turn3Votes: Map<string, 'A' | 'B' | 'ABSOLVE'> = new Map();

  private winner: 'VILLAGE' | 'WEREWOLF' | null = null;
  private winReason: string | null = null;
  private killFeed: { id: string; text: string; timestamp: number }[] = [];

  constructor(roomId: string, io: Server) {
    this.roomId = roomId;
    this.io = io;
    this.resetMapEntities();
  }

  private resetMapEntities() {
    this.totems = INITIAL_RUNIC_TOTEMS.map((t) => ({ ...t, destroyed: false }));
    this.traps = [];
    this.corpses = [];
    this.barricades = BARRICADE_SLOTS.map((slot) => ({
      slotId: slot.id,
      x: slot.x,
      y: slot.y,
      orientation: slot.orientation,
      active: false,
      removingByPlayerId: null,
      removeStartedAt: 0,
      removeEndsAt: 0
    }));
    this.positionHistory = [];
    this.siegeRadius = 1500;
    this.churchBellHp = this.churchBellMaxHp;
    this.winner = null;
    this.winReason = null;
    this.tribunal = null;
    this.eclipseActive = false;
    this.eclipseCycleTimerMs = 0;
  }

  public addLog(text: string) {
    this.killFeed.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      timestamp: Date.now()
    });
    if (this.killFeed.length > 8) {
      this.killFeed.pop();
    }
  }

  public addPlayer(id: string, name: string, isBot = false, initialXp = 15000): PlayerState {
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 80;
    const p: PlayerState = {
      id,
      name,
      isBot,
      classId: 'aldeao',
      isWerewolf: false,
      isTransformed: false,
      isAlive: true,
      x: Math.round(CHURCH_CENTER.x + Math.cos(angle) * dist),
      y: Math.round(CHURCH_CENTER.y + Math.sin(angle) * dist),
      facingAngle: 0,
      missionProgress: 0,
      isPerformingMission: false,
      abilityUnlocked: false,
      abilityCharges: CLASSES_BY_ID['aldeao'].maxCharges,
      abilityCooldownEnd: 0,
      hasBlessingShield: false,
      hasClarityBuffEnd: 0,
      hasSpeedBuffEnd: 0,
      isInvisibleEnd: 0,
      isStunnedEnd: 0,
      isRevealedEnd: 0,
      hiddenInBarrelId: null,
      usedBarrelIds: [],
      hiddenInTombId: null,
      removingBarricadeId: null,
      removingBarricadeEndsAt: 0,
      barricadeCooldownEnd: 0,
      totemsDestroyed: 0,
      hasEscapePassive: false,
      leapCooldownEnd: 0,
      totalXp: initialXp
    };
    this.players.set(id, p);
    this.addLog(`${name} entrou no vilarejo.`);
    return p;
  }

  public removePlayer(id: string) {
    const p = this.players.get(id);
    if (p) {
      this.players.delete(id);
      this.addLog(`${p.name} deixou a partida.`);
    }
  }

  /**
   * Regra de Seleção: Máximo de 1 exemplar de cada classe especial por sala.
   * Apenas o Aldeão é ilimitado.
   */
  public selectClass(playerId: string, requestedClass: ClassId): { ok: boolean; reason?: string } {
    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'Jogador não encontrado.' };

    const cls = CLASSES_BY_ID[requestedClass];
    if (!cls) return { ok: false, reason: 'Classe inválida.' };

    if (player.totalXp < cls.requiredXp) {
      return {
        ok: false,
        reason: `Classe bloqueada! Requer Nv.${cls.requiredLevel} (${cls.requiredXp.toLocaleString('pt-BR')} XP).`
      };
    }

    if (!cls.unlimitedInRoom) {
      for (const other of this.players.values()) {
        if (other.id !== playerId && other.classId === requestedClass) {
          return {
            ok: false,
            reason: `A classe ${cls.name} já foi travada por ${other.name} nesta sala!`
          };
        }
      }
    }

    player.classId = requestedClass;
    player.abilityCharges = cls.maxCharges;
    this.addLog(`${player.name} selecionou a classe ${cls.name}.`);
    return { ok: true };
  }

  /**
   * Preenche a sala com bots até atingir entre 8 e 12 jogadores e inicia a partida
   */
  public startMatchWithBots(targetCount = 9) {
    // Limpa bots anteriores se estiver reiniciando
    for (const [id, p] of this.players.entries()) {
      if (p.isBot) this.players.delete(id);
    }

    const botNames = [
      'Alaric (Bot)',
      'Beatriz (Bot)',
      'Corvus (Bot)',
      'Dante (Bot)',
      'Elena (Bot)',
      'Fausto (Bot)',
      'Gideon (Bot)',
      'Helena (Bot)',
      'Igor (Bot)',
      'Julian (Bot)'
    ];

    const availableSpecialClasses: ClassId[] = CLASSES_LIST.filter((c) => !c.unlimitedInRoom).map(
      (c) => c.id
    );

    let botIdx = 0;
    while (this.players.size < Math.max(8, Math.min(12, targetCount))) {
      const botId = `bot_${Date.now()}_${botIdx}`;
      const botName = botNames[botIdx % botNames.length];
      const bot = this.addPlayer(botId, botName, true, 50000);

      // Garante que haja um Caçador na partida para demonstrar a mecânica de Armadilha vs Escape
      const takenClasses = new Set(Array.from(this.players.values()).map((pl) => pl.classId));
      if (!takenClasses.has('cacador')) {
        bot.classId = 'cacador';
      } else {
        const freeSpecial = availableSpecialClasses.find((cid) => !takenClasses.has(cid));
        bot.classId = freeSpecial || 'aldeao';
      }
      bot.abilityCharges = CLASSES_BY_ID[bot.classId].maxCharges;
      botIdx++;
    }

    this.resetMapEntities();
    this.phase = 'PHASE_1_HUNT';
    this.phaseStartedAt = Date.now();
    this.phaseDurationSec = 240;

    // Sorteia secretamente 1 Lobisomem mantendo o disfarce visual da classe escolhida
    const allPlayers = Array.from(this.players.values());
    const wolfIndex = Math.floor(Math.random() * allPlayers.length);

    allPlayers.forEach((p, idx) => {
      const angle = (idx / allPlayers.length) * Math.PI * 2;
      p.isWerewolf = idx === wolfIndex;
      p.isTransformed = false;
      p.isAlive = true;
      p.x = Math.round(CHURCH_CENTER.x + Math.cos(angle) * 210);
      p.y = Math.round(CHURCH_CENTER.y + Math.sin(angle) * 210);
      p.missionProgress = 0;
      p.isPerformingMission = false;
      p.abilityUnlocked = false;
      p.abilityCharges = CLASSES_BY_ID[p.classId].maxCharges;
      p.hasBlessingShield = false;
      p.totemsDestroyed = 0;
      p.hasEscapePassive = false;
      p.isStunnedEnd = 0;
      p.isInvisibleEnd = 0;
      p.hiddenInBarrelId = null;
      p.usedBarrelIds = [];
      p.hiddenInTombId = null;
      p.removingBarricadeId = null;
      p.removingBarricadeEndsAt = 0;
      p.barricadeCooldownEnd = 0;
    });

    this.addLog('A noite caiu! Façam suas missões distantes para liberar suas habilidades.');
  }

  /**
   * Permite ao jogador local forçar ser Lobisomem ou Caçador para testar rapidamente todas as mecânicas
   */
  public debugSetRole(playerId: string, role: 'WEREWOLF' | 'HUNTER_VILLAGER' | 'FORCE_TRIBUNAL' | 'FORCE_BLOOD_MOON') {
    const player = this.players.get(playerId);
    if (!player) return;

    if (role === 'WEREWOLF') {
      for (const p of this.players.values()) p.isWerewolf = false;
      player.isWerewolf = true;
      player.totemsDestroyed = 2;
      player.hasEscapePassive = true;
      this.addLog(`[Teste] ${player.name} agora é o Lobisomem (com Escape carregado)!`);
    } else if (role === 'HUNTER_VILLAGER') {
      player.isWerewolf = false;
      player.classId = 'cacador';
      player.missionProgress = 100;
      player.abilityUnlocked = true;
      player.abilityCharges = 2;
      // Garante que algum bot seja lobisomem
      const bots = Array.from(this.players.values()).filter((p) => p.id !== playerId);
      if (bots.length > 0 && !bots.some((b) => b.isWerewolf)) {
        bots[0].isWerewolf = true;
      }
      this.addLog(`[Teste] ${player.name} agora é o Caçador com 2 Armadilhas prontas!`);
    } else if (role === 'FORCE_TRIBUNAL') {
      this.startTribunal(player.name, 'Toque emergencial do Sino da Igreja');
    } else if (role === 'FORCE_BLOOD_MOON') {
      this.startBloodMoonPhase();
    }
  }

  public handleMove(
    playerId: string,
    dx: number,
    dy: number,
    facingAngle: number,
    clientX?: number,
    clientY?: number
  ) {
    if (this.phase !== 'PHASE_1_HUNT' && this.phase !== 'PHASE_3_BLOOD_MOON') return;

    const p = this.players.get(playerId);
    if (!p) return;

    // Jogadores mortos (Fantasmas) podem explorar o mapa livremente sem acionar armadilhas ou interagir
    if (!p.isAlive) {
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        p.x = Math.max(60, Math.min(MAP_WIDTH - 60, Math.round(clientX)));
        p.y = Math.max(60, Math.min(MAP_HEIGHT - 60, Math.round(clientY)));
        p.facingAngle = facingAngle;
      }
      return;
    }

    const now = Date.now();
    if (now < p.isStunnedEnd) return;
    // Enquanto estiver escondido dentro de um barril/tumba OU removendo uma barricada de madeira (4s incancelável!), não pode andar!
    if (p.hiddenInBarrelId || p.hiddenInTombId || p.removingBarricadeId) return;

    let speed = 16.5;
    if (now < p.hasSpeedBuffEnd) speed *= 1.42; // Disparada +42%
    if (p.isWerewolf && p.isTransformed) {
      speed *= this.phase === 'PHASE_3_BLOOD_MOON' ? 1.28 : 1.16;
    }
    if (p.isWerewolf && isPointInChurchSacredGround(p.x, p.y)) {
      speed *= 0.62; // Solo Sagrado da Igreja reduz a velocidade do Lobisomem em 38%!
    }
    if (isPointInShallowLake(p.x, p.y)) {
      speed *= 0.55; // Água rasa do Lago do Poço desacelera em 45%
    } else if (isPointInRunicCircle(p.x, p.y)) {
      speed *= 1.22; // Círculo de Menires Rúnicos acelera em +22%
    }

    if (typeof clientX === 'number' && typeof clientY === 'number') {
      // O Lobisomem (p.isWerewolf) pode entrar na Floresta Densa para se esconder e emboscar!
      const resolved = resolveMapCollisions(
        p.x,
        p.y,
        clientX,
        clientY,
        this.barricades,
        p.isWerewolf
      );
      p.x = Math.round(resolved.x);
      p.y = Math.round(resolved.y);
      p.facingAngle = facingAngle;
    } else {
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const nx = (dx / len) * speed;
        const ny = (dy / len) * speed;
        const resolved = resolveMapCollisions(
          p.x,
          p.y,
          p.x + nx,
          p.y + ny,
          this.barricades,
          p.isWerewolf
        );
        p.x = Math.round(resolved.x);
        p.y = Math.round(resolved.y);
        p.facingAngle = facingAngle;
      }
    }

    // Dano/empurrão do círculo de cerco na Fase 3 (Lua de Sangue)
    if (this.phase === 'PHASE_3_BLOOD_MOON') {
      const distFromChurch = Math.hypot(p.x - CHURCH_CENTER.x, p.y - CHURCH_CENTER.y);
      if (distFromChurch > this.siegeRadius) {
        const pullAngle = Math.atan2(CHURCH_CENTER.y - p.y, CHURCH_CENTER.x - p.x);
        p.x = Math.round(p.x + Math.cos(pullAngle) * 12);
        p.y = Math.round(p.y + Math.sin(pullAngle) * 12);
      }
    }

    this.checkTrapCollisions(p);
  }

  /**
   * Verifica se o Lobisomem pisou em uma armadilha do Caçador ou Ferreira de Armadilhas
   */
  private checkTrapCollisions(p: PlayerState) {
    if (!p.isWerewolf || !p.isAlive) return;

    for (const trap of this.traps) {
      if (trap.triggered) continue;
      const dist = Math.hypot(p.x - trap.x, p.y - trap.y);
      if (dist <= 42) {
        trap.triggered = true;

        if (trap.type === 'BEAR_STUN') {
          p.isStunnedEnd = Date.now() + 4000;
          p.isTransformed = true;
          this.addLog(`ARMADILHA DE URSO! O Lobisomem (${p.name}) foi imobilizado por 4s!`);
          return;
        }

        // Armadilha de Caça Letal do Caçador:
        // Na Fase 3 (Lua de Sangue), o Lobisomem não tem mais Escape e a armadilha é sempre fatal!
        if (p.hasEscapePassive && this.phase === 'PHASE_1_HUNT') {
          p.hasEscapePassive = false;
          p.totemsDestroyed = 0;
          p.hasSpeedBuffEnd = Date.now() + 3000;
          p.isInvisibleEnd = Date.now() + 3000;
          this.addLog(
            `ESCAPE ATIVADO! O Lobisomem destruiu a Armadilha do Caçador e fugiu em alta velocidade, perdendo seu Escape!`
          );
        } else {
          // Sem Escape ativo: fica preso, é revelado e os moradores vencem imediatamente!
          p.isTransformed = true;
          p.isStunnedEnd = Date.now() + 30000;
          this.endMatch(
            'VILLAGE',
            `O Lobisomem (${p.name}) caiu na Armadilha do Caçador SEM Escape ativo e foi capturado!`
          );
        }
      }
    }
  }

  /**
   * Entrar ou Sair de um Barril de Esconderijo [F] para se ocultar do Lobisomem
   */
  public handleToggleBarrel(playerId: string): {
    ok: boolean;
    message: string;
    barrelId?: string | null;
    x?: number;
    y?: number;
  } {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive) {
      return { ok: false, message: 'Apenas jogadores vivos podem usar barris.' };
    }

    if (this.phase !== 'PHASE_1_HUNT' && this.phase !== 'PHASE_3_BLOOD_MOON') {
      return { ok: false, message: 'Barris indisponíveis nesta fase.' };
    }

    // Se já está escondido em um barril -> Sai do barril imediatamente!
    if (p.hiddenInBarrelId) {
      p.hiddenInBarrelId = null;
      return {
        ok: true,
        message: 'Você saiu do barril!',
        barrelId: null,
        x: p.x,
        y: p.y
      };
    }

    if (p.isWerewolf && p.isTransformed) {
      return {
        ok: false,
        message: 'Você não cabe dentro de um barril na forma monstruosa de Lobisomem!'
      };
    }

    // Procura o barril mais próximo dentro do raio de interação
    const nearBarrel = HIDING_BARRELS.find(
      (b) => Math.hypot(b.x - p.x, b.y - p.y) <= BARREL_INTERACT_RADIUS
    );
    if (!nearBarrel) {
      return { ok: false, message: 'Aproxime-se de um barril para se esconder!' };
    }

    // Regra: Depois que um personagem entra em um barril/baú, ele NÃO pode entrar de novo no mesmo!
    if (p.usedBarrelIds.includes(nearBarrel.id)) {
      return {
        ok: false,
        message: 'Você já se escondeu neste barril/baú antes e não pode entrar nele novamente!'
      };
    }

    // Verifica se já existe outro jogador escondido nesse mesmo barril
    const occupied = Array.from(this.players.values()).some(
      (other) => other.id !== p.id && other.isAlive && other.hiddenInBarrelId === nearBarrel.id
    );
    if (occupied) {
      return { ok: false, message: 'Este barril já está ocupado por outro morador!' };
    }

    p.hiddenInBarrelId = nearBarrel.id;
    p.usedBarrelIds.push(nearBarrel.id);
    p.x = nearBarrel.x;
    p.y = nearBarrel.y;

    return {
      ok: true,
      message: 'Escondido dentro do barril! O Lobisomem não pode te ver. Toque em [Sair] para deixar o barril.',
      barrelId: nearBarrel.id,
      x: nearBarrel.x,
      y: nearBarrel.y
    };
  }

  /**
   * Entrar ou Sair de uma Tumba do Cemitério [T] — EXCLUSIVO PARA O LOBISOMEM se esconder e emboscar!
   */
  public handleToggleTomb(playerId: string): {
    ok: boolean;
    message: string;
    tombId?: string | null;
    x?: number;
    y?: number;
  } {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive || !p.isWerewolf) {
      return {
        ok: false,
        message: 'Apenas o Lobisomem pode entrar e se esconder nas Tumbas do Cemitério!'
      };
    }

    if (this.phase !== 'PHASE_1_HUNT' && this.phase !== 'PHASE_3_BLOOD_MOON') {
      return { ok: false, message: 'Tumbas indisponíveis nesta fase.' };
    }

    // Se o Lobisomem já está escondido na tumba -> Salte para fora da tumba!
    if (p.hiddenInTombId) {
      p.hiddenInTombId = null;
      return {
        ok: true,
        message: 'Você emergiu da Tumba do Cemitério!',
        tombId: null,
        x: p.x,
        y: p.y
      };
    }

    const nearTomb = WEREWOLF_TOMBS.find(
      (t) => Math.hypot(t.x - p.x, t.y - p.y) <= TOMB_INTERACT_RADIUS
    );
    if (!nearTomb) {
      return { ok: false, message: 'Aproxime-se de uma Tumba no Cemitério para se esconder!' };
    }

    p.hiddenInTombId = nearTomb.id;
    p.x = nearTomb.x;
    p.y = nearTomb.y;

    return {
      ok: true,
      message:
        'Escondido na Tumba do Cemitério! Você está 100% invisível e pode se transformar ou emboscar quem passar!',
      tombId: nearTomb.id,
      x: nearTomb.x,
      y: nearTomb.y
    };
  }

  /**
   * Colocar Barricada de Madeira (Exclusivo do Lobisomem) OU Remover Barricada (Qualquer jogador, 4s incancelável!) [B]
   */
  public handleBarricadeInteract(playerId: string): { ok: boolean; message: string } {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive) {
      return { ok: false, message: 'Apenas jogadores vivos podem interagir com barricadas.' };
    }

    if (this.phase !== 'PHASE_1_HUNT' && this.phase !== 'PHASE_3_BLOOD_MOON') {
      return { ok: false, message: 'Ação indisponível nesta fase.' };
    }

    const now = Date.now();

    // 1. Se o jogador JÁ está removendo uma barricada -> NÃO PODE CANCELAR!
    if (p.removingBarricadeId) {
      const remSec = Math.max(0.1, (p.removingBarricadeEndsAt - now) / 1000).toFixed(1);
      return {
        ok: false,
        message: `Removendo madeira... Faltam ${remSec}s (Não é possível cancelar após iniciar!)`
      };
    }

    if (p.hiddenInBarrelId || p.hiddenInTombId) {
      return { ok: false, message: 'Saia do esconderijo primeiro!' };
    }

    // Encontra o ponto de passagem / barricada mais próximo
    const nearBarricade = this.barricades.find(
      (b) => Math.hypot(b.x - p.x, b.y - p.y) <= BARRICADE_INTERACT_RADIUS
    );

    if (!nearBarricade) {
      return {
        ok: false,
        message: 'Aproxime-se de uma passagem entre territórios para colocar ou remover madeira!'
      };
    }

    // 2. Se a Barricada já está ATIVA no caminho -> Qualquer jogador (inclusive o próprio Lobo) pode REMOVER em 4s incanceláveis!
    if (nearBarricade.active) {
      if (nearBarricade.removingByPlayerId) {
        const remover = this.players.get(nearBarricade.removingByPlayerId);
        if (remover && remover.isAlive) {
          return {
            ok: false,
            message: `${remover.name} já está removendo esta barricada de madeira!`
          };
        }
      }

      nearBarricade.removingByPlayerId = p.id;
      nearBarricade.removeStartedAt = now;
      nearBarricade.removeEndsAt = now + BARRICADE_REMOVE_DURATION_MS;
      p.removingBarricadeId = nearBarricade.slotId;
      p.removingBarricadeEndsAt = nearBarricade.removeEndsAt;

      return {
        ok: true,
        message: 'Removendo Barricada de Madeira (4 segundos — impossível cancelar)!'
      };
    }

    // 3. Se a passagem está ABERTA -> Apenas o Lobisomem pode colocar madeira para fechar a passagem!
    if (!p.isWerewolf) {
      return {
        ok: false,
        message: 'Apenas o Lobisomem pode bloquear passagens com madeira!'
      };
    }

    if (now < p.barricadeCooldownEnd) {
      const cd = Math.ceil((p.barricadeCooldownEnd - now) / 1000);
      return { ok: false, message: `Madeira em recarga (${cd}s).` };
    }

    nearBarricade.active = true;
    nearBarricade.removingByPlayerId = null;
    p.barricadeCooldownEnd = now + 10000; // 10s de recarga entre barricadas

    // Empurra levemente qualquer jogador que estivesse exatamente em cima da linha da barricada para não ficar preso dentro dela
    for (const other of this.players.values()) {
      if (Math.hypot(other.x - nearBarricade.x, other.y - nearBarricade.y) < 55) {
        if (nearBarricade.orientation === 'HORIZONTAL') {
          other.y += other.y < nearBarricade.y ? -45 : 45;
        } else {
          other.x += other.x < nearBarricade.x ? -45 : 45;
        }
      }
    }

    this.addLog('Uma passagem da vila foi bloqueada com tábuas pesadas de madeira!');
    return {
      ok: true,
      message: 'Barricada de Madeira erguida! A passagem está bloqueada!'
    };
  }

  /**
   * Transformação Oculta do Lobisomem:
   * Só pode se transformar em locais escondidos (milharal, atrás de casas, sob a ponte, cedros).
   */
  public handleWerewolfTransform(playerId: string): { ok: boolean; message: string } {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive || !p.isWerewolf) {
      return { ok: false, message: 'Apenas o Lobisomem pode se transformar.' };
    }

    if (this.phase === 'PHASE_3_BLOOD_MOON') {
      p.isTransformed = true;
      return { ok: false, message: 'Na Lua de Sangue você fica permanentemente na forma monstruosa!' };
    }

    if (!p.isTransformed) {
      const inCover = isPlayerInCover(p.x, p.y);
      if (!inCover) {
        return {
          ok: false,
          message: 'Você só pode se transformar em zonas ocultas (Milharal, Cedros, Ponte, Casas, Cemitério)!'
        };
      }
      p.isTransformed = true;
      return { ok: true, message: 'Transformado em Lobisomem nas sombras!' };
    } else {
      p.isTransformed = false;
      return { ok: true, message: 'Retornou ao disfarce humano.' };
    }
  }

  /**
   * Missões de Ativação (Moradores) e Missão de Escape (Totens Rúnicos do Lobisomem)
   */
  public handleMissionInteract(playerId: string): { ok: boolean; message: string } {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive || this.phase !== 'PHASE_1_HUNT') {
      return { ok: false, message: 'Missões disponíveis apenas durante a Fase 1.' };
    }

    // 1. Verificar se o Lobisomem está perto de um Totem Rúnico para carregar o Escape
    if (p.isWerewolf) {
      const nearTotem = this.totems.find(
        (t) => !t.destroyed && Math.hypot(t.x - p.x, t.y - p.y) <= 110
      );
      if (nearTotem) {
        nearTotem.destroyed = true;
        p.totemsDestroyed += 1;
        if (p.totemsDestroyed >= 2) {
          p.hasEscapePassive = true;
          this.addLog('Um calafrio percorre a vila... Totens Rúnicos foram profanados.');
          return {
            ok: true,
            message: 'Totem destruído! Habilidade passiva ESCAPE totalmente carregada!'
          };
        }
        return {
          ok: true,
          message: `Totem Rúnico destruído (${p.totemsDestroyed}/2 para ativar o Escape).`
        };
      }
    }

    // 2. Missão da Classe (para liberar a habilidade especial)
    const cls = CLASSES_BY_ID[p.classId];
    const targetZone = VILLAGE_ZONES.find((z) => z.id === cls.missionZone);
    if (!targetZone || !isPointInZone(p.x, p.y, targetZone)) {
      return {
        ok: false,
        message: `Vá até [${targetZone?.name || cls.missionZone}] para cumprir: ${cls.missionTitle}`
      };
    }

    if (p.abilityUnlocked) {
      return { ok: true, message: 'Sua habilidade especial já está desbloqueada!' };
    }

    p.isPerformingMission = true;
    const durationSec = (cls.missionDurationMs / 1000).toFixed(1);
    return {
      ok: true,
      message: `Realizando missão automaticamente (${Math.floor(p.missionProgress)}% — duração total: ${durationSec}s). Você está protegido contra o Lobisomem!`
    };
  }

  /**
   * Uso da Habilidade Especial da Classe ou Ataque/Salto do Lobisomem
   */
  public handleUseAbility(playerId: string): { ok: boolean; message: string } {
    const p = this.players.get(playerId);
    if (!p || !p.isAlive) return { ok: false, message: 'Você está morto.' };

    const now = Date.now();
    if (now < p.isStunnedEnd) return { ok: false, message: 'Você está atordoado!' };

    // Se o Lobisomem estiver transformado, tecla de habilidade executa Salto Predatório (Fase 3) ou Ataque Letal
    if (p.isWerewolf && p.isTransformed) {
      return this.executeWerewolfAttack(p);
    }

    if (!p.abilityUnlocked || p.abilityCharges <= 0) {
      return {
        ok: false,
        message: 'Habilidade bloqueada ou sem cargas! Conclua sua missão na zona indicada.'
      };
    }

    if (now < p.abilityCooldownEnd) {
      const rem = Math.ceil((p.abilityCooldownEnd - now) / 1000);
      return { ok: false, message: `Habilidade em recarga (${rem}s).` };
    }

    const cls = CLASSES_BY_ID[p.classId];
    p.abilityCharges -= 1;
    p.abilityCooldownEnd = now + cls.cooldownMs;

    switch (p.classId) {
      case 'aldeao':
        p.hasSpeedBuffEnd = now + 3000;
        return { ok: true, message: 'Disparada ativada! +40% de velocidade por 3s.' };

      case 'cacador':
        this.traps.push({
          id: `trap_${now}_${Math.random().toString(36).slice(2, 5)}`,
          ownerId: p.id,
          type: 'HUNTER_LETHAL',
          x: p.x,
          y: p.y,
          triggered: false
        });
        return { ok: true, message: 'Armadilha de Caça instalada secretamente no chão!' };

      case 'ferreira_armadilhas':
        this.traps.push({
          id: `trap_${now}_${Math.random().toString(36).slice(2, 5)}`,
          ownerId: p.id,
          type: 'BEAR_STUN',
          x: p.x,
          y: p.y,
          triggered: false
        });
        return { ok: true, message: 'Armadilha de Urso instalada!' };

      case 'lenhador': {
        const wolf = this.findNearestPlayer(p, 130);
        if (wolf && wolf.isWerewolf) {
          wolf.isStunnedEnd = now + 2000;
          wolf.isInvisibleEnd = now + 3500;
          wolf.isTransformed = false;
          p.totalXp += XP_REWARDS.TRAP_OR_STUN_WEREWOLF;
          this.addLog(`${p.name} acertou uma Machadada no Lobisomem, que fugiu invisível!`);
          return { ok: true, message: 'Machadada certeira! O Lobisomem foi atordoado por 2s!' };
        }
        return { ok: true, message: 'Machadada desferida!' };
      }

      case 'freira':
        p.hasBlessingShield = true;
        return { ok: true, message: 'Bênção Protetora ativa! Anulará o próximo ataque letal.' };

      case 'padre': {
        for (const other of this.players.values()) {
          if (other.isWerewolf && Math.hypot(other.x - p.x, other.y - p.y) <= 180) {
            other.isTransformed = false;
            other.isStunnedEnd = now + 1500;
            this.addLog(`O Padre ${p.name} exorcizou a área e forçou o Lobisomem à forma humana!`);
          }
        }
        return { ok: true, message: 'Exorcismo consagrado no solo!' };
      }

      case 'boticario': {
        for (const other of this.players.values()) {
          if (Math.hypot(other.x - p.x, other.y - p.y) <= 220) {
            other.hasClarityBuffEnd = now + 15000;
          }
        }
        return { ok: true, message: 'Poção de Clareza ativada! Visão do Eclipse restaurada por 15s.' };
      }

      case 'prefeito':
        this.startTribunal(p.name, 'Decreto do Prefeito (Sino tocado à distância)');
        return { ok: true, message: 'Tribunal da Igreja convocado à distância!' };

      case 'inquisidor': {
        const target = this.findNearestPlayer(p, 160);
        if (!target) {
          p.abilityCharges += 1;
          return { ok: false, message: 'Nenhum alvo no alcance do Julgamento Final.' };
        }
        if (target.isWerewolf) {
          this.endMatch(
            'VILLAGE',
            `O Inquisidor ${p.name} executou o Lobisomem (${target.name}) com o Julgamento Final!`
          );
          return { ok: true, message: 'Bala de Prata certeira no Lobisomem!' };
        } else {
          p.isAlive = false;
          this.addLog(
            `TRAGÉDIA! O Inquisidor ${p.name} disparou contra um inocente (${target.name}) e tombou pelo próprio juramento!`
          );
          return { ok: true, message: 'Você atirou em um inocente e perdeu a própria vida!' };
        }
      }

      default: {
        // Bardo, Alquimista, Vigia, Cartógrafo, etc. concedem buffs de velocidade e visão/revelação
        p.hasSpeedBuffEnd = now + 4000;
        p.hasClarityBuffEnd = now + 10000;
        for (const other of this.players.values()) {
          if (other.id !== p.id && Math.hypot(other.x - p.x, other.y - p.y) <= 260) {
            other.isRevealedEnd = now + 12000;
          }
        }
        return { ok: true, message: `${cls.abilityName} ativada com sucesso!` };
      }
    }
  }

  private executeWerewolfAttack(wolf: PlayerState): { ok: boolean; message: string } {
    const now = Date.now();
    if (now < wolf.abilityCooldownEnd) {
      return { ok: false, message: 'Garras em recarga!' };
    }

    // Na Fase 3 (Lua de Sangue), o Lobisomem pode atacar o Sino da Igreja!
    if (this.phase === 'PHASE_3_BLOOD_MOON') {
      const distToBell = Math.hypot(wolf.x - CHURCH_CENTER.x, wolf.y - CHURCH_CENTER.y);
      if (distToBell <= BELL_INTERACT_RADIUS + 30) {
        this.churchBellHp = Math.max(0, this.churchBellHp - 85);
        wolf.abilityCooldownEnd = now + 1100; // 50% menos recarga na Lua de Sangue
        this.addLog(`O Lobisomem atacou o Sino da Igreja! (HP: ${this.churchBellHp}/${this.churchBellMaxHp})`);
        if (this.churchBellHp <= 0) {
          this.endMatch(
            'WEREWOLF',
            'O Lobisomem estraçalhou o Sino da Igreja durante a Lua de Sangue!'
          );
        }
        return { ok: true, message: `Sino da Igreja atingido! HP restante: ${this.churchBellHp}` };
      }
    }

    const victim = this.findNearestPlayer(wolf, 105);
    if (!victim) {
      // Verifica se havia um morador ao alcance, mas que está protegido realizando missão!
      const missionProtectedPrey = Array.from(this.players.values()).find(
        (other) =>
          other.id !== wolf.id &&
          other.isAlive &&
          other.isPerformingMission &&
          Math.hypot(other.x - wolf.x, other.y - wolf.y) <= 105
      );
      if (missionProtectedPrey) {
        return {
          ok: false,
          message: `${missionProtectedPrey.name} está concentrado realizando uma missão e não pode ser atacado agora!`
        };
      }

      // Se estiver na Fase 3, executa Salto Predatório (dash curto)
      if (this.phase === 'PHASE_3_BLOOD_MOON' && now >= wolf.leapCooldownEnd) {
        wolf.x = Math.max(
          80,
          Math.min(MAP_WIDTH - 80, Math.round(wolf.x + Math.cos(wolf.facingAngle) * 140))
        );
        wolf.y = Math.max(
          80,
          Math.min(MAP_HEIGHT - 80, Math.round(wolf.y + Math.sin(wolf.facingAngle) * 140))
        );
        wolf.leapCooldownEnd = now + 8000;
        return { ok: true, message: 'Salto Predatório executado!' };
      }
      return { ok: false, message: 'Nenhuma presa ao alcance das garras.' };
    }

    const attackCooldown = this.phase === 'PHASE_3_BLOOD_MOON' ? 1400 : 2800;
    wolf.abilityCooldownEnd = now + attackCooldown;

    // Verifica se a vítima possui Bênção Protetora (Freira) -> Fuga Invisível do Lobisomem
    if (victim.hasBlessingShield) {
      victim.hasBlessingShield = false;
      wolf.isInvisibleEnd = now + 4000;
      wolf.hasSpeedBuffEnd = now + 3500;
      if (this.phase === 'PHASE_1_HUNT') {
        wolf.isTransformed = false;
      }
      this.addLog(
        `A Bênção Protetora salvou ${victim.name}! O Lobisomem foi repelido e fugiu invisível!`
      );
      return {
        ok: true,
        message: 'Alvo protegido por Bênção! Fuga Invisível ativada por 4s para escapar!'
      };
    }

    // Elimina a vítima e gera cadáver com pistas dos últimos 15s
    victim.isAlive = false;
    const recentPassersby = this.getRecentSuspectsNear(victim.x, victim.y, 15000);
    const dirs = ['Norte', 'Sul', 'Leste', 'Oeste'];
    const escapeDir = dirs[Math.floor(Math.random() * dirs.length)];

    this.corpses.push({
      id: `corpse_${now}_${victim.id}`,
      victimId: victim.id,
      victimName: victim.name,
      victimClass: victim.classId,
      x: victim.x,
      y: victim.y,
      diedAt: now,
      escapeDirection: escapeDir,
      nearbySuspects: recentPassersby,
      reported: false
    });

    this.addLog(`${victim.name} (${CLASSES_BY_ID[victim.classId].name}) foi abatido nas sombras!`);
    this.checkLivingPlayersVictory();
    return { ok: true, message: `Você eliminou ${victim.name}!` };
  }

  private getRecentSuspectsNear(x: number, y: number, windowMs: number): string[] {
    const cutoff = Date.now() - windowMs;
    const names = new Set<string>();
    for (const log of this.positionHistory) {
      if (log.timestamp >= cutoff && Math.hypot(log.x - x, log.y - y) <= 320) {
        names.add(log.playerName);
      }
    }
    return Array.from(names).slice(0, 5);
  }

  /**
   * Reportar um corpo no chão ou tocar o Sino da Igreja para iniciar a Fase 2 (Tribunal)
   */
  public handleReportOrBell(playerId: string): { ok: boolean; message: string } {
    if (this.phase !== 'PHASE_1_HUNT') {
      return { ok: false, message: 'O Tribunal só pode ser convocado durante a Fase 1.' };
    }
    const p = this.players.get(playerId);
    if (!p || !p.isAlive) return { ok: false, message: 'Apenas jogadores vivos podem convocar.' };

    // 1. Verificar corpo próximo
    const corpse = this.corpses.find(
      (c) => !c.reported && Math.hypot(c.x - p.x, c.y - p.y) <= 130
    );
    if (corpse) {
      corpse.reported = true;
      this.startTribunal(
        p.name,
        `Corpo de ${corpse.victimName} encontrado!`,
        { x: corpse.x, y: corpse.y, victimName: corpse.victimName },
        corpse.nearbySuspects
      );
      return { ok: true, message: 'Corpo reportado! Iniciando Tribunal da Igreja.' };
    }

    // 2. Verificar proximidade do Sino da Igreja
    const distToBell = Math.hypot(p.x - CHURCH_CENTER.x, p.y - CHURCH_CENTER.y);
    if (distToBell <= BELL_INTERACT_RADIUS + 30) {
      this.startTribunal(p.name, `${p.name} tocou o Sino da Igreja!`);
      return { ok: true, message: 'Sino da Igreja badalado!' };
    }

    return {
      ok: false,
      message: 'Aproxime-se de um corpo ou do Sino Central da Igreja para convocar o Tribunal.'
    };
  }

  /**
   * Inicia o Tribunal da Igreja em 3 Turnos (Votação Secreta sem Efeito Manada)
   */
  public startTribunal(
    reporterName: string,
    reason: string,
    corpseLocation?: { x: number; y: number; victimName: string },
    suspectClues?: string[]
  ) {
    this.phase = 'PHASE_2_TRIBUNAL';
    this.eclipseActive = false;
    this.turn1Votes.clear();
    this.turn3Votes.clear();

    // Teleporta todos os jogadores vivos para o interior da Igreja Central
    const alivePlayers = Array.from(this.players.values()).filter((pl) => pl.isAlive);
    alivePlayers.forEach((pl, idx) => {
      const angle = (idx / Math.max(1, alivePlayers.length)) * Math.PI * 2;
      pl.x = Math.round(CHURCH_CENTER.x + Math.cos(angle) * 115);
      pl.y = Math.round(CHURCH_CENTER.y + Math.sin(angle) * 95);
      pl.isTransformed = false;
      pl.isPerformingMission = false;
      pl.hiddenInBarrelId = null;
      pl.hiddenInTombId = null;
    });

    const autoClues =
      suspectClues && suspectClues.length > 0
        ? suspectClues
        : this.getRecentSuspectsNear(CHURCH_CENTER.x, CHURCH_CENTER.y, 15000);

    const initialChat: TribunalChatMessage[] = [
      {
        id: `chat_sys_${Date.now()}`,
        senderId: 'system',
        senderName: 'Inquisição da Vila',
        senderClass: 'inquisidor',
        text: `Tribunal convocado por ${reporterName}. Discutam as pistas com respeito (Filtro de ofensas ativo).`,
        filtered: false,
        timestamp: Date.now()
      }
    ];

    if (autoClues.length > 0) {
      const botReporter = alivePlayers.find((b) => b.isBot);
      if (botReporter) {
        initialChat.push({
          id: `chat_bot_${Date.now()}_1`,
          senderId: botReporter.id,
          senderName: botReporter.name,
          senderClass: botReporter.classId,
          text: `Olhem o relatório de pistas: ${autoClues.join(', ')} estavam perto do local nos últimos 15s!`,
          filtered: false,
          timestamp: Date.now()
        });
      }
    }

    this.tribunal = {
      active: true,
      turn: 'TURN_1_SECRET_VOTE',
      turnEndsAt: Date.now() + 45000, // Turno 1: 45s
      reporterName,
      reason,
      corpseLocation,
      suspectClues: autoClues,
      turn1VotesCount: 0,
      finalists: null,
      chatMessages: initialChat
    };

    this.addLog(`TRIBUNAL DA IGREJA: ${reason}`);
  }

  /**
   * Envia mensagem no Chat do Tribunal com Filtro Automático de Ofensas
   */
  public handleTribunalChat(
    senderId: string,
    rawText: string
  ): { ok: boolean; filtered?: boolean; message?: string } {
    if (this.phase !== 'PHASE_2_TRIBUNAL' || !this.tribunal) {
      return { ok: false, message: 'O chat só fica aberto durante a votação do Tribunal.' };
    }
    const sender = this.players.get(senderId);
    if (!sender) {
      return { ok: false, message: 'Jogador não encontrado.' };
    }
    if (!sender.isAlive) {
      return { ok: false, message: 'Fantasmas não podem falar no Tribunal dos vivos!' };
    }

    const { cleanText, wasFiltered } = sanitizeTribunalChatMessage(rawText || '');
    if (!cleanText) {
      return { ok: false, message: 'Digite uma mensagem válida.' };
    }

    this.tribunal.chatMessages.push({
      id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: sender.id,
      senderName: sender.name,
      senderClass: sender.classId,
      text: cleanText,
      filtered: wasFiltered,
      timestamp: Date.now()
    });

    if (this.tribunal.chatMessages.length > 40) {
      this.tribunal.chatMessages.shift();
    }

    return {
      ok: true,
      filtered: wasFiltered,
      message: wasFiltered
        ? 'Filtro de ofensas ativado: termos ofensivos foram censurados (***).'
        : undefined
    };
  }

  /**
   * Turno 1 (Voto Secreto) e Turno 3 (Veredito Final: Executar A, Executar B ou Absolver Ambos)
   */
  public handleTribunalVote(voterId: string, choice: string) {
    if (this.phase !== 'PHASE_2_TRIBUNAL' || !this.tribunal) return;
    const voter = this.players.get(voterId);
    if (!voter || !voter.isAlive) return;

    if (this.tribunal.turn === 'TURN_1_SECRET_VOTE') {
      if (this.players.has(choice)) {
        this.turn1Votes.set(voterId, choice);
        this.tribunal.turn1VotesCount = this.turn1Votes.size;
      }
    } else if (this.tribunal.turn === 'TURN_3_FINAL_VERDICT') {
      if (choice === 'A' || choice === 'B' || choice === 'ABSOLVE') {
        this.turn3Votes.set(voterId, choice);
      }
    }
  }

  /**
   * Permite avançar imediatamente o turno atual do Tribunal para testes rápidos
   */
  public advanceTribunalTurnNow() {
    if (this.phase !== 'PHASE_2_TRIBUNAL' || !this.tribunal) return;
    this.tribunal.turnEndsAt = Date.now() - 100;
  }

  private updateTribunalState(now: number) {
    if (!this.tribunal) return;

    // Bots votam de forma inteligente no Turno 1 e Turno 3
    for (const bot of this.players.values()) {
      if (!bot.isBot || !bot.isAlive) continue;
      if (this.tribunal.turn === 'TURN_1_SECRET_VOTE' && !this.turn1Votes.has(bot.id)) {
        const candidates = Array.from(this.players.values()).filter(
          (p) => p.isAlive && p.id !== bot.id
        );
        if (candidates.length > 0) {
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          this.turn1Votes.set(bot.id, pick.id);
          this.tribunal.turn1VotesCount = this.turn1Votes.size;
        }
      } else if (this.tribunal.turn === 'TURN_3_FINAL_VERDICT' && !this.turn3Votes.has(bot.id)) {
        const opts: ('A' | 'B' | 'ABSOLVE')[] = ['A', 'B', 'ABSOLVE'];
        this.turn3Votes.set(bot.id, opts[Math.floor(Math.random() * opts.length)]);
      }
    }

    if (now < this.tribunal.turnEndsAt) return;

    if (this.tribunal.turn === 'TURN_1_SECRET_VOTE') {
      // Calcula os 2 jogadores mais votados (Juiz tem peso 2)
      const tally = new Map<string, number>();
      for (const p of this.players.values()) {
        if (p.isAlive) tally.set(p.id, 0);
      }
      for (const [voterId, targetId] of this.turn1Votes.entries()) {
        const voter = this.players.get(voterId);
        const weight = voter?.classId === 'juiz' && voter.abilityUnlocked ? 2 : 1;
        tally.set(targetId, (tally.get(targetId) || 0) + weight);
      }

      const sorted = Array.from(tally.entries()).sort((a, b) => b[1] - a[1]);
      const firstId = sorted[0]?.[0] || Array.from(this.players.keys())[0];
      const secondId = sorted[1]?.[0] || firstId;

      this.tribunal.finalists = [firstId, secondId];
      this.tribunal.turn = 'TURN_2_DEFENSE';
      this.tribunal.turnEndsAt = now + 20000; // Turno 2: 20s de Direito de Defesa no Altar
      const pA = this.players.get(firstId);
      const pB = this.players.get(secondId);
      const nameA = pA?.name || 'Suspeito A';
      const nameB = pB?.name || 'Suspeito B';
      this.addLog(`ALTAR DE DEFESA: ${nameA} e ${nameB} foram os mais votados e têm 20s para defesa!`);

      if (pA && pA.isBot) {
        this.tribunal.chatMessages.push({
          id: `chat_def_a_${now}`,
          senderId: pA.id,
          senderName: pA.name,
          senderClass: pA.classId,
          text: `Sou ${CLASSES_BY_ID[pA.classId].name}! Eu estava cumprindo minha missão, não sou o Lobisomem!`,
          filtered: false,
          timestamp: now
        });
      }
      if (pB && pB.isBot && pB.id !== pA?.id) {
        this.tribunal.chatMessages.push({
          id: `chat_def_b_${now}`,
          senderId: pB.id,
          senderName: pB.name,
          senderClass: pB.classId,
          text: `Inocente! Olhem quem estava perto do corpo nos últimos 15s antes de atirarem a Bala de Prata!`,
          filtered: false,
          timestamp: now
        });
      }
    } else if (this.tribunal.turn === 'TURN_2_DEFENSE') {
      this.tribunal.turn = 'TURN_3_FINAL_VERDICT';
      this.tribunal.turnEndsAt = now + 15000; // Turno 3: 15s de Veredito Final
      this.addLog('VEREDITO FINAL: Votem para Executar A, Executar B ou Absolver Ambos!');
    } else if (this.tribunal.turn === 'TURN_3_FINAL_VERDICT') {
      this.resolveTribunalExecution();
    }
  }

  private resolveTribunalExecution() {
    if (!this.tribunal || !this.tribunal.finalists) return;

    let countA = 0;
    let countB = 0;
    let countAbsolve = 0;

    for (const [voterId, verdict] of this.turn3Votes.entries()) {
      const voter = this.players.get(voterId);
      const weight = voter?.classId === 'juiz' && voter.abilityUnlocked ? 2 : 1;
      if (verdict === 'A') countA += weight;
      else if (verdict === 'B') countB += weight;
      else countAbsolve += weight;
    }

    this.tribunal.finalVerdictCounts = {
      executeA: countA,
      executeB: countB,
      absolve: countAbsolve
    };

    const [idA, idB] = this.tribunal.finalists;
    let executed: PlayerState | undefined;
    let executedSlot: 'A' | 'B' | null = null;

    if (countA > countB && countA > countAbsolve) {
      executed = this.players.get(idA);
      executedSlot = 'A';
    } else if (countB > countA && countB > countAbsolve) {
      executed = this.players.get(idB);
      executedSlot = 'B';
    }

    if (!executed || !executedSlot) {
      this.addLog('O Tribunal decidiu ABSOLVER AMBOS os acusados. A caçada recomeça!');
      this.phase = 'PHASE_1_HUNT';
      this.tribunal = null;
      return;
    }

    // Execução com Tiro de Prata:
    if (!executed.isWerewolf) {
      // 1. Se o executado for Inocente: morre, vira Fantasma e quem votou pela execução perde a habilidade ativa!
      executed.isAlive = false;
      for (const [voterId, verdict] of this.turn3Votes.entries()) {
        if (verdict === executedSlot) {
          const guiltyVoter = this.players.get(voterId);
          if (guiltyVoter && !guiltyVoter.isWerewolf) {
            guiltyVoter.abilityUnlocked = false;
            guiltyVoter.missionProgress = 0;
          }
        }
      }
      this.addLog(
        `TIRO DE PRATA: ${executed.name} era INOCENTE! Quem votou pela execução perdeu sua habilidade ativa!`
      );
      this.tribunal = null;
      this.phase = 'PHASE_1_HUNT';
      this.checkLivingPlayersVictory();
    } else {
      // 2. O executado é o Lobisomem!
      if (!executed.hasEscapePassive) {
        // Sem Escape ativo -> morre e a vila vence imediatamente!
        executed.isAlive = false;
        this.endMatch(
          'VILLAGE',
          `TIRO DE PRATA CERTEIRO! O Lobisomem (${executed.name}) foi executado no altar sem Escape ativo!`
        );
      } else {
        // 3. Com Escape ativo -> sobrevive ao tiro, revela forma monstruosa, estilhaça o vitral e inicia a Fase 3 (Lua de Sangue)!
        executed.hasEscapePassive = false;
        executed.isTransformed = true;
        executed.isInvisibleEnd = Date.now() + 4500;
        this.addLog(
          `VITRAL ESTILHAÇADO! ${executed.name} era o Lobisomem, sobreviveu ao Tiro de Prata com ESCAPE e iniciou a LUA DE SANGUE!`
        );
        this.startBloodMoonPhase();
      }
    }
  }

  /**
   * Fase 3: Caçada Final — Lua de Sangue (Sudden Death de 90 segundos)
   */
  public startBloodMoonPhase() {
    this.phase = 'PHASE_3_BLOOD_MOON';
    this.phaseStartedAt = Date.now();
    this.phaseDurationSec = 90;
    this.tribunal = null;
    this.eclipseActive = false;
    this.siegeRadius = 1450;
    this.churchBellHp = this.churchBellMaxHp;

    for (const p of this.players.values()) {
      p.isPerformingMission = false;
      if (p.isWerewolf) {
        p.isTransformed = true;
        p.hasEscapePassive = false;
      }
    }
  }

  private checkLivingPlayersVictory() {
    const aliveVillagers = Array.from(this.players.values()).filter(
      (p) => p.isAlive && !p.isWerewolf
    );
    const aliveWolves = Array.from(this.players.values()).filter(
      (p) => p.isAlive && p.isWerewolf
    );

    if (aliveWolves.length === 0) {
      this.endMatch('VILLAGE', 'O Lobisomem foi eliminado! O vilarejo está salvo!');
    } else if (aliveVillagers.length === 0) {
      for (const w of aliveWolves) {
        w.totalXp += XP_REWARDS.WEREWOLF_SOLO_VICTORY;
      }
      this.endMatch(
        'WEREWOLF',
        'Todos os moradores foram devorados! Vitória solitária do Lobisomem (+1.000 XP)!'
      );
    }
  }

  public endMatch(winner: 'VILLAGE' | 'WEREWOLF', reason: string) {
    this.phase = 'POST_GAME';
    this.winner = winner;
    this.winReason = reason;
    this.tribunal = null;
    this.addLog(`FIM DE PARTIDA: ${reason}`);
  }

  /**
   * Processa o giro da Roda da Vitória (Skill Check pós-jogo) no servidor
   */
  public handleSpinVictoryWheel(playerId: string, stoppedAngleDeg: number) {
    const p = this.players.get(playerId);
    if (!p) return null;

    const result = evaluateVictoryWheelAngle(stoppedAngleDeg);
    p.totalXp += result.xpEarned;
    this.addLog(`Roda da Vitória: ${p.name} conquistou ${result.label}!`);
    return {
      ...result,
      newTotalXp: p.totalXp
    };
  }

  private findNearestPlayer(source: PlayerState, maxDist: number): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDist = maxDist;
    for (const other of this.players.values()) {
      // Jogadores escondidos dentro de um barril OU realizando missão (isPerformingMission)
      // ficam protegidos e o Lobisomem NÃO pode matá-los durante a missão!
      if (
        other.id === source.id ||
        !other.isAlive ||
        other.hiddenInBarrelId ||
        other.isPerformingMission
      ) {
        continue;
      }
      const d = Math.hypot(other.x - source.x, other.y - source.y);
      if (d <= bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  /**
   * Atualiza o carregamento AUTOMÁTICO da barra de missão quando o jogador está no território da missão:
   * - Cada classe possui seu próprio tempo de carregamento (cls.missionDurationMs: de 3.8s a 8.5s).
   * - Enquanto está carregando a missão (isPerformingMission = true), o Lobisomem NÃO pode matar o jogador!
   */
  private updateAutomaticMissions(deltaMs: number, now: number) {
    for (const p of this.players.values()) {
      if (
        !p.isAlive ||
        p.abilityUnlocked ||
        p.hiddenInBarrelId ||
        p.hiddenInTombId ||
        p.removingBarricadeId ||
        (p.isWerewolf && p.isTransformed)
      ) {
        p.isPerformingMission = false;
        continue;
      }

      const cls = CLASSES_BY_ID[p.classId];
      const targetZone = VILLAGE_ZONES.find((z) => z.id === cls.missionZone);
      if (!targetZone || !isPointInZone(p.x, p.y, targetZone)) {
        p.isPerformingMission = false;
        continue;
      }

      // Está dentro da zona da missão -> carrega automaticamente na velocidade específica daquela missão!
      p.isPerformingMission = true;
      const speedMult = now < p.hasSpeedBuffEnd ? 1.35 : 1.0; // Canção do Bardo acelera a missão
      const durationMs = Math.max(2000, cls.missionDurationMs || 5000);
      const incrementPct = (deltaMs / durationMs) * 100 * speedMult;

      p.missionProgress = Math.min(100, Number((p.missionProgress + incrementPct).toFixed(1)));

      if (p.missionProgress >= 100) {
        p.missionProgress = 100;
        p.isPerformingMission = false;
        p.abilityUnlocked = true;
        p.abilityCharges = cls.maxCharges;
        p.totalXp += XP_REWARDS.MISSION_COMPLETED;
        this.addLog(`${p.name} concluiu a missão [${cls.missionTitle}] e liberou ${cls.abilityName}!`);
      }
    }
  }

  /**
   * Loop autoritativo de 20 ticks por segundo (50ms)
   */
  public tick(deltaMs: number) {
    const now = Date.now();

    if (this.phase === 'PHASE_1_HUNT') {
      this.updateBarricadesProgress(now);
      this.updateAutomaticMissions(deltaMs, now);
      // Ciclo do Eclipse Lunar a cada 40s (dura 14s)
      this.eclipseCycleTimerMs += deltaMs;
      const cyclePos = this.eclipseCycleTimerMs % 45000;
      const shouldBeEclipse = cyclePos >= 30000;
      if (shouldBeEclipse && !this.eclipseActive) {
        this.eclipseActive = true;
        this.addLog('ECLIPSE LUNAR! A escuridão consome o vilarejo e silencia as vozes distantes!');
      } else if (!shouldBeEclipse && this.eclipseActive) {
        this.eclipseActive = false;
        for (const p of this.players.values()) {
          if (p.isAlive) p.totalXp += XP_REWARDS.SURVIVE_ECLIPSE;
        }
        this.addLog('A luz da lua retorna. Sobreviventes receberam +90 XP.');
      }

      this.updateBotsAI(now);
      this.recordPositions(now);
    } else if (this.phase === 'PHASE_2_TRIBUNAL') {
      this.updateTribunalState(now);
    } else if (this.phase === 'PHASE_3_BLOOD_MOON') {
      this.updateBarricadesProgress(now);
      const elapsedSec = (now - this.phaseStartedAt) / 1000;
      const progress = Math.min(1, elapsedSec / 90);
      // O círculo de cerco fecha gradualmente das bordas (1450px) até o pátio da igreja (270px) em 90s
      this.siegeRadius = Math.round(1450 - progress * (1450 - 270));

      this.updateBotsAI(now);

      if (elapsedSec >= 90) {
        if (this.churchBellHp > 0) {
          this.endMatch(
            'VILLAGE',
            'A alvorada chegou após 90 segundos e o Sino da Igreja permaneceu intacto! Vitória da Vila!'
          );
        }
      }
    }
  }

  private updateBarricadesProgress(now: number) {
    for (const bar of this.barricades) {
      if (!bar.active || !bar.removingByPlayerId) continue;

      const remover = this.players.get(bar.removingByPlayerId);
      // Se o jogador que estava removendo morreu no meio dos 4s, interrompe a remoção e mantém a barricada!
      if (!remover || !remover.isAlive) {
        if (remover) {
          remover.removingBarricadeId = null;
          remover.removingBarricadeEndsAt = 0;
        }
        bar.removingByPlayerId = null;
        bar.removeStartedAt = 0;
        bar.removeEndsAt = 0;
        continue;
      }

      // Completou os 4 segundos incanceláveis -> destrói a barricada e libera o jogador!
      if (now >= bar.removeEndsAt) {
        bar.active = false;
        bar.removingByPlayerId = null;
        bar.removeStartedAt = 0;
        bar.removeEndsAt = 0;
        remover.removingBarricadeId = null;
        remover.removingBarricadeEndsAt = 0;
        this.addLog(`${remover.name} removeu uma Barricada de Madeira e liberou a estrada!`);
      }
    }
  }

  private recordPositions(now: number) {
    // Registra histórico a cada ~500ms para o relatório automático de pistas do Tribunal
    if (
      this.positionHistory.length === 0 ||
      now - this.positionHistory[this.positionHistory.length - 1].timestamp >= 500
    ) {
      for (const p of this.players.values()) {
        if (p.isAlive) {
          this.positionHistory.push({
            playerId: p.id,
            playerName: p.name,
            x: p.x,
            y: p.y,
            timestamp: now
          });
        }
      }
      const cutoff = now - 16000;
      while (this.positionHistory.length > 0 && this.positionHistory[0].timestamp < cutoff) {
        this.positionHistory.shift();
      }
    }
  }

  /**
   * Move um bot até (targetX, targetY) seguindo as Trilhas e Estradas da Vila Antiga
   * (passando pelo cruzamento central da Catedral ou pelas trilhas Norte/Sul/Oeste sem cortar caminho pelo mato!).
   */
  private moveBotTowards(bot: PlayerState, targetX: number, targetY: number) {
    let wx = targetX;
    let wy = targetY;

    const botWest = bot.x <= RIVER_LEFT_BANK;
    const targetEast = targetX > RIVER_LEFT_BANK;
    const botEast = bot.x >= 3620;
    const targetWest = targetX < 3620;

    if ((botWest && targetEast) || (botEast && targetWest)) {
      if (bot.y < 1310 || bot.y > 1490) {
        wx = botWest ? 2990 : 3700;
        wy = 1400;
      } else {
        wx = targetEast ? 3720 : 2990;
        wy = 1400;
      }
    } else if (Math.hypot(targetX - bot.x, targetY - bot.y) > 750) {
      // Se o destino está do outro lado da vila, roteia pela Estrada Central (y = 1400 ou x = 2100)
      if (Math.abs(bot.y - 1400) > 260 && Math.abs(bot.x - targetX) > 450) {
        wx = bot.x < 1200 ? 680 : bot.x > 2500 ? 2990 : 2100;
        wy = 1400;
      } else if (Math.abs(bot.y - 1400) <= 260 && Math.abs(bot.x - targetX) > 380) {
        wx = targetX < 1200 ? 680 : targetX > 2500 ? 2990 : 2100;
        wy = 1400;
      }
    }

    const angle = Math.atan2(wy - bot.y, wx - bot.x);
    this.handleMove(bot.id, Math.cos(angle), Math.sin(angle), angle);
  }

  private updateBotsAI(now: number) {
    for (const bot of this.players.values()) {
      if (!bot.isBot || !bot.isAlive || now < bot.isStunnedEnd) continue;

      if (this.phase === 'PHASE_3_BLOOD_MOON') {
        // Na Fase 3, todos correm em direção ao pátio da Igreja Central
        const dist = Math.hypot(CHURCH_CENTER.x - bot.x, CHURCH_CENTER.y - bot.y);
        if (dist > 140) {
          this.moveBotTowards(bot, CHURCH_CENTER.x, CHURCH_CENTER.y);
        } else if (bot.isWerewolf) {
          this.executeWerewolfAttack(bot);
        }
        continue;
      }

      // Fase 1: Bots moradores vão até a zona da missão de sua classe
      if (!bot.isWerewolf) {
        const cls = CLASSES_BY_ID[bot.classId];
        const zone = VILLAGE_ZONES.find((z) => z.id === cls.missionZone);
        if (zone) {
          const tx = zone.x + zone.width / 2;
          const ty = zone.y + zone.height / 2;
          const dist = Math.hypot(tx - bot.x, ty - bot.y);
          if (dist > 60 && !bot.abilityUnlocked) {
            this.moveBotTowards(bot, tx, ty);
          } else if (!bot.abilityUnlocked && Math.random() < 0.08) {
            this.handleMissionInteract(bot.id);
          } else {
            // Patrulha pelo vilarejo e instala armadilhas se for Caçador
            const patrolAngle = bot.facingAngle + (Math.random() - 0.5) * 0.4;
            this.handleMove(bot.id, Math.cos(patrolAngle), Math.sin(patrolAngle), patrolAngle);
            if (bot.classId === 'cacador' && bot.abilityUnlocked && bot.abilityCharges > 0 && Math.random() < 0.03) {
              this.handleUseAbility(bot.id);
            }
          }
        }
      } else {
        // Bot Lobisomem: destrói totens primeiro para garantir o Escape e depois caça
        const nextTotem = this.totems.find((t) => !t.destroyed);
        if (nextTotem && !bot.hasEscapePassive) {
          const dist = Math.hypot(nextTotem.x - bot.x, nextTotem.y - bot.y);
          this.moveBotTowards(bot, nextTotem.x, nextTotem.y);
          if (dist <= 95) {
            this.handleMissionInteract(bot.id);
          }
        } else {
          if (!bot.isTransformed && isPlayerInCover(bot.x, bot.y)) {
            bot.isTransformed = true;
          }
          const prey = this.findNearestPlayer(bot, 900);
          if (prey) {
            this.moveBotTowards(bot, prey.x, prey.y);
            if (Math.hypot(prey.x - bot.x, prey.y - bot.y) <= 95 && bot.isTransformed) {
              this.executeWerewolfAttack(bot);
            }
          }
        }
      }
    }
  }

  public getSnapshotForPlayer(viewerId: string): WorldSnapshot {
    const now = Date.now();
    const viewer = this.players.get(viewerId);
    const elapsedSec = Math.floor((now - this.phaseStartedAt) / 1000);
    const phaseTimerSec = Math.max(0, this.phaseDurationSec - elapsedSec);

    const cyclePos = this.eclipseCycleTimerMs % 45000;
    const eclipseRemainingSec = this.eclipseActive
      ? Math.max(0, Math.ceil((45000 - cyclePos) / 1000))
      : Math.max(0, Math.ceil((30000 - cyclePos) / 1000));

    // O servidor autoritativo mascara quem é o Lobisomem caso ele esteja em forma humana!
    const sanitizedPlayers: PlayerState[] = Array.from(this.players.values()).map((p) => {
      const isSelf = p.id === viewerId;
      const revealWolfIdentity =
        isSelf ||
        this.phase === 'POST_GAME' ||
        this.phase === 'PHASE_3_BLOOD_MOON' ||
        p.isTransformed;

      return {
        ...p,
        isWerewolf: revealWolfIdentity ? p.isWerewolf : false
      };
    });

    // Filtra armadilhas ocultas para que o Lobisomem não as veja no cliente
    const visibleTraps = this.traps.filter((t) => {
      if (t.triggered) return true;
      if (!viewer) return true;
      return !viewer.isWerewolf || t.ownerId === viewerId;
    });

    return {
      roomId: this.roomId,
      phase: this.phase,
      phaseTimerSec,
      eclipseActive: this.eclipseActive,
      eclipseRemainingSec,
      siegeRadius: this.siegeRadius,
      churchBellHp: this.churchBellHp,
      churchBellMaxHp: this.churchBellMaxHp,
      players: sanitizedPlayers,
      totems: this.totems,
      traps: visibleTraps,
      corpses: this.corpses,
      barricades: this.barricades,
      tribunal: this.tribunal,
      winner: this.winner,
      winReason: this.winReason,
      killFeed: this.killFeed
    };
  }
}
