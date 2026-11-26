import { Server } from 'socket.io';
import { CLASSES_BY_ID, CLASSES_LIST } from '../shared/classesData';
import {
  BARRICADE_INTERACT_RADIUS,
  BARRICADE_REMOVE_DURATION_MS,
  BARRICADE_SLOTS,
  BARREL_INTERACT_RADIUS,
  BELL_INTERACT_RADIUS,
  BLOOD_MOON_DURATION_SEC,
  CHURCH_CENTER,
  CLEAR_MOON_DURATION_MS,
  FULL_LUNAR_CYCLE_MS,
  HIDING_BARRELS,
  INITIAL_RUNIC_TOTEMS,
  MAP_HEIGHT,
  MAP_WIDTH,
  RIVER_LEFT_BANK,
  TOMB_INTERACT_RADIUS,
  VILLAGE_ZONES,
  WEREWOLF_TOMBS,
  clampToLobbyChurchBounds,
  isPlayerInCover,
  isPointInChurchSacredGround,
  isPointInRunicCircle,
  isPointInShallowLake,
  isPointInZone,
  resolveLobbyFenceCollisions,
  resolveMapCollisions
} from '../shared/mapData';
import { XP_REWARDS, evaluateVictoryWheelAngle } from '../shared/progressionData';
import { sanitizeTribunalChatMessage } from '../shared/profanityFilter';
import {
  BarricadeEntity,
  BrazilianRoomSummary,
  ClassId,
  CorpseEntity,
  GamePhase,
  HunterRelicEntity,
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
  public roomName: string;
  public regionLabel: string;
  public requiredPlayers: number = 9;
  public maxPlayers: number = 12;
  public isCustom: boolean = false;
  public creatorName?: string;
  private lobbyCountdownEndsAt: number | null = null;
  public readonly lobbyCountdownDurationMs: number = 5000; // 5 segundos de contagem regressiva após completar o time!

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
  private hunterRelic: HunterRelicEntity | null = null;
  private positionHistory: PositionLog[] = [];

  private tribunal: TribunalState | null = null;
  private tribunalStartedAt: number = 0;
  private turn1Votes: Map<string, string> = new Map(); // voterId -> targetId
  private turn3Votes: Map<string, 'A' | 'B' | 'ABSOLVE'> = new Map();

  private winner: 'VILLAGE' | 'WEREWOLF' | null = null;
  private winReason: string | null = null;
  private killFeed: { id: string; text: string; timestamp: number }[] = [];
  private lobbyChatMessages: TribunalChatMessage[] = [];
  private postGameStartedAt: number = 0;

  constructor(
    roomId: string,
    io: Server,
    roomName = 'Sala Brasil #1 — Serra da Mantiqueira',
    regionLabel = 'BR • São Paulo (14ms)',
    requiredPlayers = 9,
    maxPlayers = 12,
    isCustom = false,
    creatorName?: string
  ) {
    this.roomId = roomId;
    this.io = io;
    this.roomName = roomName;
    this.regionLabel = regionLabel;
    this.requiredPlayers = requiredPlayers;
    this.maxPlayers = maxPlayers;
    this.isCustom = isCustom;
    this.creatorName = creatorName;
    this.resetMapEntities();
  }

  public getRoomSummary(): BrazilianRoomSummary {
    const now = Date.now();
    const lobbyCountdownSec =
      this.phase === 'LOBBY' && this.lobbyCountdownEndsAt !== null
        ? Math.max(0, Math.ceil((this.lobbyCountdownEndsAt - now) / 1000))
        : null;
    return {
      roomId: this.roomId,
      roomName: this.roomName,
      regionLabel: this.regionLabel,
      phase: this.phase,
      playerCount: this.players.size,
      requiredPlayers: this.requiredPlayers,
      maxPlayers: this.maxPlayers,
      lobbyCountdownSec,
      isCustom: this.isCustom,
      creatorName: this.creatorName
    };
  }

  /**
   * Verifica se a sala no LOBBY acumulou o número mínimo necessário de pessoas (requiredPlayers).
   * - Se atingiu requiredPlayers e o contador ainda não estava rodando -> inicia contagem regressiva de 5s!
   * - Se alguém SAIU depois de o time estar completo e o total caiu abaixo de requiredPlayers -> O CONTADOR ZERA IMEDIATAMENTE!
   */
  public evaluateLobbyReadiness() {
    if (this.phase !== 'LOBBY') {
      this.lobbyCountdownEndsAt = null;
      return;
    }

    const currentCount = this.players.size;
    if (currentCount >= this.requiredPlayers) {
      if (this.lobbyCountdownEndsAt === null) {
        this.lobbyCountdownEndsAt = Date.now() + this.lobbyCountdownDurationMs;
        this.addLog(
          `Time completo (${currentCount}/${this.requiredPlayers})! Iniciando partida em 5 segundos...`
        );
      }
    } else {
      if (this.lobbyCountdownEndsAt !== null) {
        this.lobbyCountdownEndsAt = null;
        this.addLog(
          `Um jogador saiu e o time ficou incompleto (${currentCount}/${this.requiredPlayers})! Contador regressivo ZERADO!`
        );
      }
    }
  }

  private resetMapEntities() {
    this.totems = INITIAL_RUNIC_TOTEMS.map((t) => ({ ...t, destroyed: false }));
    this.traps = [];
    this.corpses = [];
    this.hunterRelic = null;
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

  public addPlayer(
    id: string,
    name: string,
    isBot = false,
    initialXp = 15000,
    sessionToken?: string
  ): PlayerState {
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 80;
    const clampedSpawn = clampToLobbyChurchBounds(
      Math.round(CHURCH_CENTER.x + Math.cos(angle) * dist),
      Math.round(CHURCH_CENTER.y + Math.sin(angle) * dist)
    );
    const p: PlayerState = {
      id,
      sessionToken,
      name,
      isBot,
      isConnected: true,
      reconnectDeadlineMs: null,
      classId: 'aldeao',
      isWerewolf: false,
      isTransformed: false,
      isAlive: true,
      x: clampedSpawn.x,
      y: clampedSpawn.y,
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
      guiltSlowEnd: 0,
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
    this.addLog(`${name} entrou na sala (${this.players.size}/${this.requiredPlayers}).`);

    // Se for um bot recém-adicionado no lobby, escolhe um traje livre aleatório (excluindo Caçador, que é sorteado junto com o Lobo no início da partida!)
    if (isBot) {
      const availableSpecialClasses: ClassId[] = CLASSES_LIST.filter(
        (c) => !c.unlimitedInRoom && c.id !== 'cacador'
      ).map((c) => c.id);
      const takenClasses = new Set(Array.from(this.players.values()).map((pl) => pl.classId));
      const freeSpecials = availableSpecialClasses.filter((cid) => !takenClasses.has(cid));
      p.classId =
        freeSpecials.length > 0
          ? freeSpecials[Math.floor(Math.random() * freeSpecials.length)]
          : 'aldeao';
      p.abilityCharges = CLASSES_BY_ID[p.classId].maxCharges;
    }

    this.evaluateLobbyReadiness();
    return p;
  }

  public removePlayer(id: string) {
    const p = this.players.get(id);
    if (p) {
      this.players.delete(id);
      this.addLog(`${p.name} saiu da sala (${this.players.size}/${this.requiredPlayers}).`);
      this.evaluateLobbyReadiness();
    }
  }

  /**
   * Trata queda de conexão (disconnect) com Janela de Reconexão de 45 Segundos:
   * - Se a sala estiver no LOBBY: remove da sala normalmente (zerando contador se estava completo).
   * - Se a partida já começou: o jogador NÃO morre na hora! Tem 45 segundos (reconnectDeadlineMs = now + 45000)
   *   para reconectar enquanto a IA assume temporariamente o boneco (Autopilot).
   * - Se o tempo de 45s expirar (ou clicar em Abandonar Partida): aplica penalidade (-100 XP) e transfere
   *   o papel de Lobisomem ou Caçador para um morador vivo para que a partida nunca trave!
   */
  public handlePlayerDisconnect(socketId: string): { keptForReconnect: boolean } {
    const p = this.players.get(socketId);
    if (!p) return { keptForReconnect: false };

    if (this.phase === 'LOBBY') {
      this.removePlayer(socketId);
      return { keptForReconnect: false };
    }

    p.isConnected = false;
    p.reconnectDeadlineMs = Date.now() + 45000; // 45 segundos para reconectar!
    this.addLog(
      `${p.name} desconectou! Janela de 45s aberta para reconexão (Piloto Automático ativo).`
    );
    return { keptForReconnect: true };
  }

  /**
   * Verifica se existe um jogador nesta sala com o mesmo sessionToken (para reconectar em até 45s!)
   */
  public findPlayerBySessionToken(token: string): PlayerState | null {
    if (!token) return null;
    for (const p of this.players.values()) {
      if (!p.isBot && p.sessionToken === token) {
        return p;
      }
    }
    return null;
  }

  /**
   * Reconecta um jogador dentro da janela de 45s trocando o antigo socket.id pelo novo socket.id
   * e preservando 100% da posição, papel (Lobo/Caçador/Classe), progresso de missão e XP!
   */
  public reconnectPlayerSocket(oldSocketId: string, newSocketId: string, token: string): PlayerState | null {
    const p = this.players.get(oldSocketId);
    if (!p) return null;

    if (oldSocketId !== newSocketId) {
      this.players.delete(oldSocketId);
      p.id = newSocketId;
      this.players.set(newSocketId, p);

      // Atualiza referências de ID em armadilhas, barricadas e votos do Tribunal
      for (const t of this.traps) {
        if (t.ownerId === oldSocketId) t.ownerId = newSocketId;
      }
      for (const b of this.barricades) {
        if (b.removingByPlayerId === oldSocketId) b.removingByPlayerId = newSocketId;
      }
      if (this.turn1Votes.has(oldSocketId)) {
        const v = this.turn1Votes.get(oldSocketId)!;
        this.turn1Votes.delete(oldSocketId);
        this.turn1Votes.set(newSocketId, v);
      }
      for (const [k, v] of this.turn1Votes.entries()) {
        if (v === oldSocketId) this.turn1Votes.set(k, newSocketId);
      }
      if (this.turn3Votes.has(oldSocketId)) {
        const v3 = this.turn3Votes.get(oldSocketId)!;
        this.turn3Votes.delete(oldSocketId);
        this.turn3Votes.set(newSocketId, v3);
      }
      if (this.tribunal?.finalists) {
        if (this.tribunal.finalists[0] === oldSocketId) this.tribunal.finalists[0] = newSocketId;
        if (this.tribunal.finalists[1] === oldSocketId) this.tribunal.finalists[1] = newSocketId;
      }
    }

    p.sessionToken = token;
    p.isConnected = true;
    p.reconnectDeadlineMs = null;
    this.addLog(`${p.name} reconectou à partida dentro da janela de 45s!`);
    return p;
  }

  /**
   * Processa o abandono definitivo de um jogador (quando os 45s de reconexão expiram OU quando clica em Abandonar):
   * - Aplica penalidade de deserção (-100 XP).
   * - Se era o LOBISOMEM: na Fase 1 transfere secretamente a Maldição do Lobo (com os Totens/Escape já conquistados!)
   *   para um morador vivo (priorizando Aldeão); na Fase 3 (Lua de Sangue), a IA Feral assume até o fim!
   * - Se era o CAÇADOR: transfere o Rifle e as Armadilhas de Caça restantes para um morador vivo (priorizando Aldeão)!
   */
  public resolveExpiredReconnectOrAbandon(playerId: string, reasonLabel = '45s de reconexão esgotados') {
    const p = this.players.get(playerId);
    if (!p) return;

    p.isConnected = false;
    p.reconnectDeadlineMs = null;
    p.totalXp = Math.max(0, p.totalXp - 100); // Penalidade anti-abandono: -100 XP
    p.matchmakingTimeoutUntilMs = Date.now() + 60000; // Bloqueio temporário de 60s para entrar em outra sala

    if (this.phase === 'LOBBY') {
      this.removePlayer(playerId);
      return;
    }

    // 1. Se o jogador que caiu/abandonou era o LOBISOMEM:
    // — Sucessão da Maldição (Transferência Secreta) na Fase 1/2 e IA Feral na Fase 3 (Lua de Sangue)!
    if (p.isWerewolf && p.isAlive) {
      if (this.phase === 'PHASE_3_BLOOD_MOON') {
        // Na Fase 3 (Lua de Sangue), todo mundo já vê a fera atacando o Sino -> IA Feral assume até o fim!
        p.isBot = true;
        this.addLog(
          `O Lobisomem (${p.name}) abandonou (${reasonLabel}, -100 XP)! A IA Feral assumiu o controle da fera na Lua de Sangue!`
        );
        return;
      }

      // Na Fase 1 ou Fase 2: o antigo boneco do Lobo cai morto como vítima da noite e a Maldição
      // é transferida SECRETAMENTE para um Aldeão vivo!
      const candidates = Array.from(this.players.values()).filter(
        (other) => other.id !== p.id && other.isAlive && !other.isWerewolf
      );
      const preferred =
        candidates.find((c) => !c.isBot && c.classId === 'aldeao') ||
        candidates.find((c) => c.classId === 'aldeao') ||
        candidates.find((c) => !c.isBot && c.classId !== 'cacador') ||
        candidates.find((c) => c.classId !== 'cacador') ||
        candidates[0];

      if (preferred) {
        preferred.isWerewolf = true;
        preferred.totemsDestroyed = p.totemsDestroyed;
        preferred.hasEscapePassive = p.hasEscapePassive;
        p.isWerewolf = false;
        p.isTransformed = false;
        p.isAlive = false;

        // Deixa o corpo do antigo hospedeiro no chão como se tivesse sucumbido à maldição
        this.corpses.push({
          id: `corpse_curse_${Date.now()}`,
          victimId: p.id,
          victimName: p.name,
          victimClass: p.classId,
          x: p.x,
          y: p.y,
          diedAt: Date.now(),
          escapeDirection: 'Sombra misteriosa',
          nearbySuspects: this.getRecentSuspectsNear(p.x, p.y, 15000, p.name),
          reported: false
        });

        this.addLog(
          `${p.name} sucumbiu nas sombras (${reasonLabel}, -100 XP). A Maldição do Lobisomem despertou secretamente em um novo hospedeiro!`
        );
      } else {
        p.isBot = true;
        this.addLog(
          `${p.name} abandonou (${reasonLabel}, -100 XP). A IA assumiu o controle do Lobisomem!`
        );
      }
      this.checkLivingPlayersVictory();
      return;
    }

    // 2. Se o jogador que caiu/abandonou era o CAÇADOR:
    // — Herança das Armas do Caçador (Relíquia no Chão OU Sucessão Automática)!
    // Deixa cair a Relíquia / Rifle & Bolsa de Armadilhas do Caçador no chão onde ele estava;
    // qualquer morador vivo que passar por cima pega na hora, ou após 10s a sucessão automática entrega a um Aldeão vivo!
    if (p.classId === 'cacador' && p.isAlive) {
      this.hunterRelic = {
        id: `relic_${Date.now()}`,
        x: p.x,
        y: p.y,
        droppedBy: p.name,
        missionProgress: p.missionProgress,
        abilityUnlocked: p.abilityUnlocked,
        abilityCharges: Math.max(1, p.abilityCharges),
        autoAssignAtMs: Date.now() + 10000
      };
      p.classId = 'aldeao';
      p.isAlive = false;
      this.addLog(
        `O Caçador (${p.name}) caiu (${reasonLabel}, -100 XP)! A Relíquia do Caçador (Rifle & Armadilhas) caiu no chão — pegue-a ou ela será herdada automaticamente em 10s!`
      );
      this.checkLivingPlayersVictory();
      return;
    }

    // 3. Morador comum que não reconectou em 45s: a IA assume o boneco para não prejudicar a Vila
    p.isBot = true;
    this.addLog(
      `${p.name} não reconectou em 45s (-100 XP). O Piloto Automático (IA) assumiu o personagem até o fim da partida.`
    );
  }

  /**
   * Verifica a cada tick se algum jogador desconectado ultrapassou o limite de 45 segundos
   */
  private checkReconnectDeadlines(now: number) {
    for (const p of Array.from(this.players.values())) {
      if (p.isConnected === false && p.reconnectDeadlineMs && now >= p.reconnectDeadlineMs) {
        this.resolveExpiredReconnectOrAbandon(p.id, '45s de reconexão esgotados');
      }
    }

    // Se a Relíquia do Caçador caiu no chão e ninguém passou por cima em 10s, aciona a Sucessão Automática para um Aldeão vivo!
    if (this.hunterRelic && now >= this.hunterRelic.autoAssignAtMs) {
      const candidates = Array.from(this.players.values()).filter(
        (other) => other.isAlive && !other.isWerewolf
      );
      const heir =
        candidates.find((c) => !c.isBot && c.classId === 'aldeao') ||
        candidates.find((c) => c.classId === 'aldeao') ||
        candidates[0];
      if (heir) {
        heir.classId = 'cacador';
        heir.missionProgress = Math.max(heir.missionProgress, this.hunterRelic.missionProgress);
        heir.abilityUnlocked = heir.abilityUnlocked || this.hunterRelic.abilityUnlocked;
        heir.abilityCharges = Math.max(1, this.hunterRelic.abilityCharges);
        this.addLog(
          `Sucessão Automática das Armas do Caçador: ${heir.name} herdou o Rifle e as Armadilhas de Caça!`
        );
      }
      this.hunterRelic = null;
    }
  }

  /**
   * Simula a entrada de 1 jogador brasileiro no lobby (para acumular jogadores gradualmente até o mínimo necessário)
   */
  public addSimulatedLobbyPlayer(): { ok: boolean; message: string; playerCount: number } {
    if (this.phase !== 'LOBBY') {
      return { ok: false, message: 'A partida já está em andamento!', playerCount: this.players.size };
    }
    if (this.players.size >= this.maxPlayers) {
      return { ok: false, message: 'A sala atingiu a capacidade máxima (12/12)!', playerCount: this.players.size };
    }

    const brNames = [
      'Matheus_SP',
      'Gabriel_RJ',
      'Letícia_MG',
      'Rafael_RS',
      'Camila_PR',
      'Lucas_BA',
      'Amanda_PE',
      'Thiago_CE',
      'Beatriz_SC',
      'Felipe_GO',
      'Juliana_DF',
      'Pedro_AM'
    ];
    const usedNames = new Set(Array.from(this.players.values()).map((pl) => pl.name));
    const pickName =
      brNames.find((n) => !usedNames.has(n)) || `JogadorBR_${this.players.size + 1}`;
    const botId = `bot_br_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.addPlayer(botId, pickName, true, 50000);

    return {
      ok: true,
      message: `${pickName} entrou na sala (${this.players.size}/${this.requiredPlayers})!`,
      playerCount: this.players.size
    };
  }

  /**
   * Simula a saída de 1 jogador do lobby (se o time estava completo, o contador regressivo ZERA na hora!)
   */
  public removeSimulatedLobbyPlayer(): {
    ok: boolean;
    message: string;
    playerCount: number;
    countdownReset: boolean;
  } {
    const wasCountingDown = this.lobbyCountdownEndsAt !== null;
    const removable = Array.from(this.players.values())
      .reverse()
      .find((pl) => pl.isBot);

    if (!removable) {
      return {
        ok: false,
        message: 'Não há outros jogadores na sala para remover.',
        playerCount: this.players.size,
        countdownReset: false
      };
    }

    this.removePlayer(removable.id);
    const countdownReset = wasCountingDown && this.lobbyCountdownEndsAt === null;

    return {
      ok: true,
      message: countdownReset
        ? `${removable.name} saiu após o time completo! CONTADOR ZERADO (${this.players.size}/${this.requiredPlayers})!`
        : `${removable.name} saiu da sala (${this.players.size}/${this.requiredPlayers}).`,
      playerCount: this.players.size,
      countdownReset
    };
  }

  /**
   * Retorna TODOS os jogadores que terminaram a partida para a MESMA SALA no estado de LOBBY
   * (mantendo todos os jogadores juntos e posicionados na Praça da Catedral Central!).
   */
  public returnToLobby(keepAllCurrentPlayers = true) {
    if (!keepAllCurrentPlayers) {
      for (const [id, p] of this.players.entries()) {
        if (p.isBot) this.players.delete(id);
      }
    }

    this.phase = 'LOBBY';
    this.lobbyCountdownEndsAt = null;
    this.resetMapEntities();

    const allPlayers = Array.from(this.players.values());
    allPlayers.forEach((p, idx) => {
      const angle = (idx / Math.max(1, allPlayers.length)) * Math.PI * 2;
      const clamped = clampToLobbyChurchBounds(
        Math.round(CHURCH_CENTER.x + Math.cos(angle) * 165),
        Math.round(CHURCH_CENTER.y + Math.sin(angle) * 135)
      );
      p.x = clamped.x;
      p.y = clamped.y;
      p.isAlive = true;
      p.isWerewolf = false;
      p.isTransformed = false;
      if (p.classId === 'cacador') {
        p.classId = 'aldeao';
      }
      p.missionProgress = 0;
      p.isPerformingMission = false;
      p.abilityUnlocked = false;
      p.abilityCharges = CLASSES_BY_ID[p.classId].maxCharges;
      p.hasBlessingShield = false;
      p.totemsDestroyed = 0;
      p.hasEscapePassive = false;
      p.isStunnedEnd = 0;
      p.isInvisibleEnd = 0;
      p.guiltSlowEnd = 0;
      p.hiddenInBarrelId = null;
      p.usedBarrelIds = [];
      p.hiddenInTombId = null;
      p.removingBarricadeId = null;
      p.removingBarricadeEndsAt = 0;
      p.barricadeCooldownEnd = 0;
    });

    this.lobbyChatMessages.push({
      id: `lchat_sys_${Date.now()}`,
      senderId: 'system',
      senderName: 'Catedral da Vila',
      senderClass: 'inquisidor',
      text: `Todos os ${allPlayers.length} jogadores retornaram para [${this.roomName}] na Praça da Catedral! Conversem ou troquem de personagem antes da próxima rodada.`,
      filtered: false,
      timestamp: Date.now()
    });
    if (this.lobbyChatMessages.length > 35) {
      this.lobbyChatMessages.shift();
    }

    // Se a sala já está com o grupo completo que terminou a partida, dá 12 segundos no Lobby da Catedral
    // para conversarem no chat e trocarem de personagem no Armário antes da próxima rodada começar!
    if (this.players.size >= this.requiredPlayers) {
      this.lobbyCountdownEndsAt = Date.now() + 12000;
      this.addLog(
        `De volta à sala [${this.roomName}] com os mesmos ${this.players.size} jogadores! Próxima partida em 12 segundos...`
      );
    } else {
      this.evaluateLobbyReadiness();
    }
  }

  /**
   * Inicia a partida com os jogadores já acumulados na sala:
   * - O LOBISOMEM e o CAÇADOR são sorteados 100% ALEATORIAMENTE entre todos os jogadores da sala no início da partida!
   */
  public launchMatchFromCurrentPlayers() {
    this.lobbyCountdownEndsAt = null;
    this.resetMapEntities();
    this.phase = 'PHASE_1_HUNT';
    this.phaseStartedAt = Date.now();
    this.phaseDurationSec = 360;

    const allPlayers = Array.from(this.players.values());
    const wolfIndex = Math.floor(Math.random() * allPlayers.length);

    // Se alguém tinha equipado 'cacador' antes, volta para 'aldeao' para que o Caçador seja sorteado aleatoriamente entre os inocentes!
    for (const pl of allPlayers) {
      if (pl.classId === 'cacador') {
        pl.classId = 'aldeao';
      }
    }

    // Sorteia 1 Caçador aleatório entre todos os jogadores que NÃO foram sorteados como Lobisomem!
    const nonWolfIndices = allPlayers.map((_, idx) => idx).filter((idx) => idx !== wolfIndex);
    const hunterIndex =
      nonWolfIndices.length > 0
        ? nonWolfIndices[Math.floor(Math.random() * nonWolfIndices.length)]
        : -1;

    allPlayers.forEach((p, idx) => {
      const angle = (idx / Math.max(1, allPlayers.length)) * Math.PI * 2;
      p.isWerewolf = idx === wolfIndex;
      if (idx === hunterIndex) {
        p.classId = 'cacador';
      }
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
      p.guiltSlowEnd = 0;
      p.hiddenInBarrelId = null;
      p.usedBarrelIds = [];
      p.hiddenInTombId = null;
      p.removingBarricadeId = null;
      p.removingBarricadeEndsAt = 0;
      p.barricadeCooldownEnd = 0;
    });

    const hunterPlayer = hunterIndex >= 0 ? allPlayers[hunterIndex] : null;
    this.addLog(
      `Partida iniciada em [${this.roomName}]! O Lobisomem (secreto) e o Caçador (${hunterPlayer?.name || 'Sorteado'}) foram sorteados aleatoriamente!`
    );
  }

  /**
   * Regra de Seleção no Lobby:
   * - Só é permitido trocar de personagem no LOBBY (antes da partida iniciar).
   * - O Lobisomem e o Caçador são sorteados aleatoriamente quando a partida começa!
   * - Máximo de 1 exemplar de cada classe especial por sala (apenas o Aldeão é ilimitado).
   */
  public selectClass(playerId: string, requestedClass: ClassId): { ok: boolean; reason?: string } {
    if (this.phase !== 'LOBBY') {
      return {
        ok: false,
        reason: 'Você só pode trocar de personagem na sala de espera (Lobby) antes da partida começar!'
      };
    }

    const player = this.players.get(playerId);
    if (!player) return { ok: false, reason: 'Jogador não encontrado.' };

    if (requestedClass === 'cacador') {
      return {
        ok: false,
        reason: 'O Caçador e o Lobisomem são sorteados aleatoriamente quando a partida começa!'
      };
    }

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
            reason: `A classe ${cls.name} já foi escolhida por ${other.name} nesta sala!`
          };
        }
      }
    }

    player.classId = requestedClass;
    player.abilityCharges = cls.maxCharges;
    this.addLog(`${player.name} equipou o personagem ${cls.name}.`);
    return { ok: true };
  }

  /**
   * Preenche a sala com bots até atingir o total necessário e inicia a partida sorteando Lobo e Caçador aleatoriamente!
   */
  public startMatchWithBots(targetCount = 9) {
    // Limpa bots anteriores se estiver reiniciando
    for (const [id, p] of this.players.entries()) {
      if (p.isBot) this.players.delete(id);
    }

    const botNames = [
      'Matheus_SP',
      'Gabriel_RJ',
      'Letícia_MG',
      'Rafael_RS',
      'Camila_PR',
      'Lucas_BA',
      'Amanda_PE',
      'Thiago_CE',
      'Beatriz_SC',
      'Felipe_GO',
      'Juliana_DF'
    ];

    let botIdx = 0;
    const desiredTotal = Math.max(4, Math.min(12, targetCount));
    while (this.players.size < desiredTotal) {
      const botId = `bot_${Date.now()}_${botIdx}`;
      const botName = botNames[botIdx % botNames.length];
      this.addPlayer(botId, botName, true, 50000);
      botIdx++;
    }

    this.launchMatchFromCurrentPlayers();
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
    // Permite movimentar o boneco livremente também durante a fase de espera na sala (LOBBY), estilo Among Us!
    if (
      this.phase !== 'LOBBY' &&
      this.phase !== 'PHASE_1_HUNT' &&
      this.phase !== 'PHASE_3_BLOOD_MOON'
    ) {
      return;
    }

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

    // Velocidade base do servidor (36 px por tick de 80ms = ~450 px/s, alinhado com a velocidade do jogador!)
    let speed = 36;
    if (now < p.hasSpeedBuffEnd) speed *= 1.42; // Disparada +42%
    if (now < p.guiltSlowEnd) speed *= 0.72; // Penalidade de Culpa por votar em inocente (-28% velocidade)
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
      if (this.phase === 'LOBBY') {
        const fenced = resolveLobbyFenceCollisions(p.x, p.y, resolved.x, resolved.y);
        p.x = Math.round(fenced.x);
        p.y = Math.round(fenced.y);
      } else {
        p.x = Math.round(resolved.x);
        p.y = Math.round(resolved.y);
      }
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
        if (this.phase === 'LOBBY') {
          const fenced = resolveLobbyFenceCollisions(p.x, p.y, resolved.x, resolved.y);
          p.x = Math.round(fenced.x);
          p.y = Math.round(fenced.y);
        } else {
          p.x = Math.round(resolved.x);
          p.y = Math.round(resolved.y);
        }
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

    this.checkHunterRelicPickup(p);
    this.checkTrapCollisions(p);
  }

  /**
   * Herança das Armas do Caçador (Relíquia no Chão OU Sucessão Automática):
   * - Se um morador vivo (preferencialmente Aldeão ou qualquer inocente) passar por cima da Relíquia no chão (<= 85px),
   *   ele coleta o Rifle e as Armadilhas de Caça na hora!
   */
  private checkHunterRelicPickup(p: PlayerState) {
    if (!this.hunterRelic || !p.isAlive || p.isWerewolf) return;
    const dist = Math.hypot(p.x - this.hunterRelic.x, p.y - this.hunterRelic.y);
    if (dist <= 85) {
      p.classId = 'cacador';
      p.missionProgress = Math.max(p.missionProgress, this.hunterRelic.missionProgress);
      p.abilityUnlocked = p.abilityUnlocked || this.hunterRelic.abilityUnlocked;
      p.abilityCharges = Math.max(1, this.hunterRelic.abilityCharges);
      this.addLog(
        `${p.name} recolheu a Relíquia do Caçador no chão e assumiu o Rifle e as Armadilhas de Caça!`
      );
      this.hunterRelic = null;
    }
  }

  /**
   * Verifica se o Lobisomem pisou em uma armadilha do Caçador ou Ferreira de Armadilhas
   */
  private checkTrapCollisions(p: PlayerState) {
    if (!p.isWerewolf || !p.isAlive) return;

    for (const trap of this.traps) {
      if (trap.triggered) continue;
      const dist = Math.hypot(p.x - trap.x, p.y - trap.y);
      if (dist <= 65) {
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
        const wolf = Array.from(this.players.values()).find(
          (other) =>
            other.id !== p.id &&
            other.isAlive &&
            other.isWerewolf &&
            Math.hypot(other.x - p.x, other.y - p.y) <= 165
        );
        if (wolf) {
          wolf.isStunnedEnd = now + 3500;
          wolf.isInvisibleEnd = now + 3500;
          if (this.phase === 'PHASE_1_HUNT') {
            wolf.isTransformed = false;
          }
          p.totalXp += XP_REWARDS.TRAP_OR_STUN_WEREWOLF;
          this.addLog(`${p.name} acertou uma Machadada no Lobisomem, que ficou atordoado por 3.5s!`);
          return { ok: true, message: 'Machadada certeira! O Lobisomem foi atordoado por 3.5s!' };
        }
        return { ok: true, message: 'Machadada desferida!' };
      }

      case 'marceneiro': {
        const nearBar = this.barricades.find(
          (b) => Math.hypot(b.x - p.x, b.y - p.y) <= BARRICADE_INTERACT_RADIUS + 40
        );
        if (!nearBar) {
          p.abilityCharges += 1;
          p.abilityCooldownEnd = 0;
          return {
            ok: false,
            message: 'Aproxime-se de uma passagem entre territórios para usar a ferramenta do Marceneiro!'
          };
        }
        if (nearBar.active) {
          nearBar.active = false;
          nearBar.removingByPlayerId = null;
          nearBar.removeStartedAt = 0;
          nearBar.removeEndsAt = 0;
          this.addLog(`O Marceneiro ${p.name} desmontou instantaneamente uma Barricada de Madeira!`);
          return { ok: true, message: 'Barricada desmontada instantaneamente com suas ferramentas!' };
        } else {
          nearBar.active = true;
          this.addLog(`O Marceneiro ${p.name} ergueu uma Barricada de Proteção na estrada!`);
          return { ok: true, message: 'Barricada de Madeira erguida para proteger a passagem!' };
        }
      }

      case 'sacerdote': {
        const target = this.findNearestPlayer(p, 200);
        if (!target) {
          p.abilityCharges += 1;
          p.abilityCooldownEnd = 0;
          return { ok: false, message: 'Aproxime-se de um jogador para realizar a Confissão.' };
        }
        const status = target.isWerewolf
          ? `A alma de ${target.name} emana trevas (${target.totemsDestroyed}/2 Totens profanados)!`
          : target.abilityUnlocked
            ? `${target.name} (${CLASSES_BY_ID[target.classId].name}) está com a habilidade CARREGADA.`
            : `${target.name} (${CLASSES_BY_ID[target.classId].name}) está com a habilidade VAZIA (${Math.floor(target.missionProgress)}%).`;
        return { ok: true, message: `Confissão: ${status}` };
      }

      case 'ferreiro': {
        const ally = Array.from(this.players.values()).find(
          (other) =>
            other.id !== p.id &&
            other.isAlive &&
            Math.hypot(other.x - p.x, other.y - p.y) <= 200
        );
        if (!ally) {
          p.abilityCharges += 1;
          p.abilityCooldownEnd = 0;
          return { ok: false, message: 'Aproxime-se de um aliado para Reforjar sua habilidade!' };
        }
        const allyCls = CLASSES_BY_ID[ally.classId];
        ally.abilityUnlocked = true;
        ally.missionProgress = 100;
        ally.abilityCharges = allyCls.maxCharges;
        ally.abilityCooldownEnd = 0;
        this.addLog(`O Ferreiro ${p.name} reforjou o equipamento de ${ally.name}!`);
        return {
          ok: true,
          message: `Habilidade [${allyCls.abilityName}] de ${ally.name} restaurada ao máximo!`
        };
      }

      case 'coveiro': {
        const corpse = this.corpses.find((c) => Math.hypot(c.x - p.x, c.y - p.y) <= 185);
        if (!corpse) {
          p.abilityCharges += 1;
          p.abilityCooldownEnd = 0;
          return { ok: false, message: 'Aproxime-se de um cadáver para realizar a Autópsia!' };
        }
        const deadSec = Math.max(1, Math.round((now - corpse.diedAt) / 1000));
        const suspects =
          corpse.nearbySuspects.length > 0
            ? corpse.nearbySuspects.join(', ')
            : 'ninguém avistado';
        return {
          ok: true,
          message: `Autópsia de ${corpse.victimName}: morreu há ${deadSec}s. Fuga do Lobo: ${corpse.escapeDirection}. Rastros: ${suspects}.`
        };
      }

      case 'pastor': {
        const hiddenOrWolf = Array.from(this.players.values()).find(
          (other) =>
            other.id !== p.id &&
            other.isAlive &&
            (other.isWerewolf ||
              other.isTransformed ||
              other.hiddenInBarrelId ||
              other.hiddenInTombId ||
              isPlayerInCover(other.x, other.y))
        );
        if (hiddenOrWolf) {
          hiddenOrWolf.isRevealedEnd = now + 10000;
          const dir =
            hiddenOrWolf.y < p.y - 120
              ? 'Norte'
              : hiddenOrWolf.y > p.y + 120
                ? 'Sul'
                : hiddenOrWolf.x > p.x
                  ? 'Leste'
                  : 'Oeste';
          this.addLog(`O Cão de Guarda de ${p.name} latiu ferozmente para o ${dir}!`);
          return {
            ok: true,
            message: `Cão de Guarda farejou perigo ao ${dir} (${hiddenOrWolf.name} revelado por 10s)!`
          };
        }
        return { ok: true, message: 'O Cão de Guarda patrulhou a área: nenhuma fera oculta por perto.' };
      }

      case 'bardo': {
        for (const other of this.players.values()) {
          if (other.isAlive && Math.hypot(other.x - p.x, other.y - p.y) <= 320) {
            other.hasSpeedBuffEnd = now + 6000;
          }
        }
        this.addLog(`O Bardo ${p.name} entoou a Canção de Coragem (+Velocidade e +Missão em área)!`);
        return {
          ok: true,
          message: 'Canção de Coragem! Aliados próximos ganharam velocidade e missão acelerada por 6s!'
        };
      }

      case 'cartografo': {
        for (const other of this.players.values()) {
          if (other.isAlive) {
            other.isRevealedEnd = now + 6000;
          }
        }
        p.hasClarityBuffEnd = now + 10000;
        return {
          ok: true,
          message: 'Olho de Águia! Todos os moradores vivos e ocultos foram revelados no mapa por 6s!'
        };
      }

      case 'freira':
        p.hasBlessingShield = true;
        return { ok: true, message: 'Bênção Protetora ativa! Anulará o próximo ataque letal.' };

      case 'padre': {
        for (const other of this.players.values()) {
          if (other.isWerewolf && Math.hypot(other.x - p.x, other.y - p.y) <= 210) {
            if (this.phase === 'PHASE_1_HUNT') {
              other.isTransformed = false;
            }
            other.isStunnedEnd = now + 3500;
            other.isInvisibleEnd = 0;
            this.addLog(`O Padre ${p.name} exorcizou a área e imobilizou o Lobisomem com luz sagrada!`);
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
        if (this.eclipseActive) {
          p.abilityCharges += 1;
          return {
            ok: false,
            message: 'Durante o Eclipse Lunar, o Sino da Igreja fica fechado e não pode ser tocado!'
          };
        }
        this.startTribunal(p.name, 'Decreto do Prefeito (Sino tocado à distância)');
        return { ok: true, message: 'Tribunal da Igreja convocado à distância!' };

      case 'inquisidor': {
        const wolfInSight = Array.from(this.players.values()).find(
          (other) =>
            other.id !== p.id &&
            other.isAlive &&
            (other.isTransformed || now < other.isRevealedEnd) &&
            Math.hypot(other.x - p.x, other.y - p.y) <= 210
        );
        const target = wolfInSight || this.findNearestPlayer(p, 160);
        if (!target) {
          p.abilityCharges += 1;
          p.abilityCooldownEnd = 0;
          return { ok: false, message: 'Nenhum alvo no alcance do Julgamento Final.' };
        }
        if (target.isWerewolf) {
          if (target.hasEscapePassive && this.phase === 'PHASE_1_HUNT') {
            target.hasEscapePassive = false;
            target.totemsDestroyed = 0;
            target.isTransformed = true;
            target.isStunnedEnd = now + 4000;
            this.addLog(
              `JULGAMENTO DE PRATA! O Inquisidor ${p.name} alvejou o Lobisomem (${target.name}), que queimou seu ESCAPE para sobreviver e foi revelado!`
            );
            return {
              ok: true,
              message: 'Bala de Prata atingiu o Lobisomem! Ele perdeu o Escape e foi revelado!'
            };
          }
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

    const victim = this.findNearestPlayer(wolf, 105);

    // Na Fase 3 (Lua de Sangue), o Lobisomem pode atacar o Sino da Igreja ou os moradores que o cercam!
    // Se houver defensores vivos bem em cima do Lobo (dist <= 95), ele divide os golpes entre os defensores e o Sino!
    if (this.phase === 'PHASE_3_BLOOD_MOON') {
      const distToBell = Math.hypot(wolf.x - CHURCH_CENTER.x, wolf.y - CHURCH_CENTER.y);
      const shouldStrikeBell = distToBell <= BELL_INTERACT_RADIUS + 30 && (!victim || Math.random() < 0.58);
      if (shouldStrikeBell) {
        this.churchBellHp = Math.max(0, this.churchBellHp - 20);
        wolf.abilityCooldownEnd = now + 2100;
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

      // Se estiver na Fase 3, executa Salto Predatório (dash curto validado contra Rio e Barricadas)
      if (this.phase === 'PHASE_3_BLOOD_MOON' && now >= wolf.leapCooldownEnd) {
        const leapTargetX = wolf.x + Math.cos(wolf.facingAngle) * 140;
        const leapTargetY = wolf.y + Math.sin(wolf.facingAngle) * 140;
        const resolved = resolveMapCollisions(
          wolf.x,
          wolf.y,
          leapTargetX,
          leapTargetY,
          this.barricades,
          true
        );
        wolf.x = Math.round(resolved.x);
        wolf.y = Math.round(resolved.y);
        wolf.leapCooldownEnd = now + 8000;
        return { ok: true, message: 'Salto Predatório executado!' };
      }
      return { ok: false, message: 'Nenhuma presa ao alcance das garras.' };
    }

    const attackCooldown = this.phase === 'PHASE_3_BLOOD_MOON' ? 16500 : 23000;
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

    // Elimina a vítima e gera cadáver com pistas dos últimos 15s (excluindo o próprio nome da vítima!)
    victim.isAlive = false;
    const recentPassersby = this.getRecentSuspectsNear(victim.x, victim.y, 15000, victim.name);
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

  private getRecentSuspectsNear(
    x: number,
    y: number,
    windowMs: number,
    excludePlayerName?: string
  ): string[] {
    const cutoff = Date.now() - windowMs;
    const names = new Set<string>();
    for (const log of this.positionHistory) {
      if (
        log.playerName !== excludePlayerName &&
        log.timestamp >= cutoff &&
        Math.hypot(log.x - x, log.y - y) <= 360
      ) {
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

    // 2. Verificar proximidade do Sino da Igreja (Durante o Eclipse Lunar, o Sino fica fechado!)
    const distToBell = Math.hypot(p.x - CHURCH_CENTER.x, p.y - CHURCH_CENTER.y);
    if (distToBell <= BELL_INTERACT_RADIUS + 30) {
      if (this.eclipseActive) {
        return {
          ok: false,
          message: 'O Sino da Igreja está fechado durante o Eclipse Lunar! Aguarde a Lua Clara.'
        };
      }
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
    this.tribunalStartedAt = Date.now();
    this.eclipseActive = false;
    this.turn1Votes.clear();
    this.turn3Votes.clear();

    // Teleporta todos os jogadores vivos para o interior da Igreja Central e limpa estados pendentes de barricada
    for (const bar of this.barricades) {
      bar.removingByPlayerId = null;
      bar.removeStartedAt = 0;
      bar.removeEndsAt = 0;
    }

    const alivePlayers = Array.from(this.players.values()).filter((pl) => pl.isAlive);
    alivePlayers.forEach((pl, idx) => {
      const angle = (idx / Math.max(1, alivePlayers.length)) * Math.PI * 2;
      pl.x = Math.round(CHURCH_CENTER.x + Math.cos(angle) * 115);
      pl.y = Math.round(CHURCH_CENTER.y + Math.sin(angle) * 95);
      pl.isTransformed = false;
      pl.isPerformingMission = false;
      pl.hiddenInBarrelId = null;
      pl.hiddenInTombId = null;
      pl.removingBarricadeId = null;
      pl.removingBarricadeEndsAt = 0;
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
   * Chat da Sala de Espera (LOBBY) na Praça da Catedral Central com Filtro Automático de Ofensas!
   */
  public handleLobbyChat(
    senderId: string,
    rawText: string
  ): { ok: boolean; filtered?: boolean; message?: string } {
    if (this.phase !== 'LOBBY') {
      return { ok: false, message: 'O chat do Lobby só fica ativo na sala de espera.' };
    }
    const sender = this.players.get(senderId);
    if (!sender) {
      return { ok: false, message: 'Jogador não encontrado na sala.' };
    }

    const { cleanText, wasFiltered } = sanitizeTribunalChatMessage(rawText || '');
    if (!cleanText) {
      return { ok: false, message: 'Digite uma mensagem válida.' };
    }

    this.lobbyChatMessages.push({
      id: `lchat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      senderId: sender.id,
      senderName: sender.name,
      senderClass: sender.classId,
      text: cleanText,
      filtered: wasFiltered,
      timestamp: Date.now()
    });

    if (this.lobbyChatMessages.length > 35) {
      this.lobbyChatMessages.shift();
    }

    // Se houver bots na sala de espera, um deles responde amigavelmente para dar vida ao chat da Catedral!
    const bots = Array.from(this.players.values()).filter((p) => p.isBot);
    if (bots.length > 0 && Math.random() < 0.45) {
      const responder = bots[Math.floor(Math.random() * bots.length)];
      const replies = [
        'Bora fechar a sala! Quem vai pegar o Padre ou a Freira?',
        'Já escolhi meu personagem aqui no Armário da Catedral!',
        'Fiquem espertos no Eclipse Lunar quando a partida começar.',
        'Boa sorte a todos, vamos descobrir quem será sorteado como Lobo!'
      ];
      this.lobbyChatMessages.push({
        id: `lchat_bot_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        senderId: responder.id,
        senderName: responder.name,
        senderClass: responder.classId,
        text: replies[Math.floor(Math.random() * replies.length)],
        filtered: false,
        timestamp: Date.now() + 10
      });
      if (this.lobbyChatMessages.length > 35) {
        this.lobbyChatMessages.shift();
      }
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

  /**
   * Aplica a Penalidade de Falsa Acusação sempre que um jogador vota em um INOCENTE:
   * 1. Perde a habilidade desbloqueada e zera o progresso da missão (precisa refazer a missão).
   * 2. Perde 50 XP da conta.
   * 3. Recebe o peso da Culpa (-28% velocidade de movimento por 18s e revelação por 8s).
   */
  private applyInnocentVotePenalty(voter: PlayerState, innocentTarget: PlayerState, contextLabel: string) {
    if (voter.isWerewolf) return;
    const now = Date.now();
    voter.abilityUnlocked = false;
    voter.missionProgress = 0;
    voter.isPerformingMission = false;
    voter.totalXp = Math.max(0, voter.totalXp - 50);
    voter.guiltSlowEnd = Math.max(voter.guiltSlowEnd, now + 18000);
    voter.isRevealedEnd = Math.max(voter.isRevealedEnd, now + 8000);

    if (this.tribunal) {
      this.tribunal.chatMessages.push({
        id: `chat_pen_${now}_${voter.id}`,
        senderId: 'system',
        senderName: 'Penalidade do Tribunal',
        senderClass: 'juiz',
        text: `${voter.name} votou em um inocente (${innocentTarget.name}) no ${contextLabel} e sofreu penalidade: Habilidade zerada, -50 XP e Lentidão de Culpa!`,
        filtered: false,
        timestamp: now
      });
    }
  }

  private updateTribunalState(now: number) {
    if (!this.tribunal) return;

    // Bots (e jogadores desconectados em Piloto Automático durante os 45s!) votam de forma inteligente no Turno 1 e Turno 3
    for (const bot of this.players.values()) {
      if ((!bot.isBot && bot.isConnected !== false) || !bot.isAlive) continue;
      if (this.tribunal.turn === 'TURN_1_SECRET_VOTE' && !this.turn1Votes.has(bot.id)) {
        const candidates = Array.from(this.players.values()).filter(
          (p) => p.isAlive && p.id !== bot.id
        );
        if (candidates.length > 0) {
          // Se o bot é morador, prioriza votar em quem apareceu no relatório de pistas perto do corpo nos últimos 15s
          const clueSuspects = candidates.filter((c) =>
            this.tribunal?.suspectClues.includes(c.name)
          );
          const pool = !bot.isWerewolf && clueSuspects.length > 0 ? clueSuspects : candidates;
          const pick = pool[Math.floor(Math.random() * pool.length)];
          this.turn1Votes.set(bot.id, pick.id);
          this.tribunal.turn1VotesCount = this.turn1Votes.size;
        }
      } else if (this.tribunal.turn === 'TURN_3_FINAL_VERDICT' && !this.turn3Votes.has(bot.id)) {
        const [idA, idB] = this.tribunal.finalists || [null, null];
        const pA = idA ? this.players.get(idA) : undefined;
        const pB = idB ? this.players.get(idB) : undefined;
        const aInClues = Boolean(pA && this.tribunal.suspectClues.includes(pA.name));
        const bInClues = Boolean(pB && this.tribunal.suspectClues.includes(pB.name));

        if (bot.isWerewolf) {
          // O Lobo tenta incriminar um inocente que esteja no altar
          if (pA && !pA.isWerewolf) this.turn3Votes.set(bot.id, 'A');
          else if (pB && !pB.isWerewolf) this.turn3Votes.set(bot.id, 'B');
          else this.turn3Votes.set(bot.id, 'ABSOLVE');
        } else {
          // Moradores votam em quem apareceu nas pistas recentes perto do corpo; se ambos apareceram, escolhem um dos suspeitos para julgar!
          if (aInClues && !bInClues) {
            this.turn3Votes.set(bot.id, Math.random() < 0.88 ? 'A' : 'ABSOLVE');
          } else if (bInClues && !aInClues) {
            this.turn3Votes.set(bot.id, Math.random() < 0.88 ? 'B' : 'ABSOLVE');
          } else if (aInClues && bInClues) {
            this.turn3Votes.set(bot.id, Math.random() < 0.55 ? 'A' : 'B');
          } else {
            this.turn3Votes.set(bot.id, Math.random() < 0.65 ? 'ABSOLVE' : 'A');
          }
        }
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
    const finalistA = this.players.get(idA);
    const finalistB = this.players.get(idB);

    // Regra: Toda vez que alguém vota em um inocente para execução no Veredito Final (ou o indicou no Turno 1 sem ser o Lobo),
    // esse eleitor sofre a Penalidade de Falsa Acusação (uma única vez por Tribunal)!
    const penalizedInThisTribunal = new Set<string>();
    for (const [voterId, verdict] of this.turn3Votes.entries()) {
      const voter = this.players.get(voterId);
      if (!voter || penalizedInThisTribunal.has(voterId)) continue;
      if (verdict === 'A' && finalistA && !finalistA.isWerewolf) {
        this.applyInnocentVotePenalty(voter, finalistA, 'Veredito Final');
        penalizedInThisTribunal.add(voterId);
      } else if (verdict === 'B' && finalistB && !finalistB.isWerewolf) {
        this.applyInnocentVotePenalty(voter, finalistB, 'Veredito Final');
        penalizedInThisTribunal.add(voterId);
      }
    }

    let executed: PlayerState | undefined;
    let executedSlot: 'A' | 'B' | null = null;

    if (countA > countB && countA > countAbsolve) {
      executed = finalistA;
      executedSlot = 'A';
    } else if (countB > countA && countB > countAbsolve) {
      executed = finalistB;
      executedSlot = 'B';
    }

    // Restitui o tempo que ficou pausado durante o Tribunal para que o relógio da Fase 1 não seja consumido pela reunião!
    const pausedDurationMs = this.tribunalStartedAt > 0 ? Date.now() - this.tribunalStartedAt : 0;

    if (!executed || !executedSlot) {
      this.addLog('O Tribunal decidiu ABSOLVER AMBOS os acusados. A caçada recomeça!');
      this.phaseStartedAt += pausedDurationMs;
      this.phase = 'PHASE_1_HUNT';
      this.tribunal = null;
      return;
    }

    // Execução com Tiro de Prata:
    if (!executed.isWerewolf) {
      // 1. Se o executado for Inocente: morre, vira Fantasma e todos que votaram nele já receberam a penalidade!
      executed.isAlive = false;
      this.addLog(
        `TIRO DE PRATA: ${executed.name} era INOCENTE! Quem votou contra um inocente sofreu penalidade (-50 XP, habilidade zerada e lentidão de culpa)!`
      );
      this.phaseStartedAt += pausedDurationMs;
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
   * Fase 3: Caçada Final — Lua de Sangue (140 segundos)
   */
  public startBloodMoonPhase() {
    this.phase = 'PHASE_3_BLOOD_MOON';
    this.phaseStartedAt = Date.now();
    this.phaseDurationSec = BLOOD_MOON_DURATION_SEC;
    this.tribunal = null;
    this.eclipseActive = false;
    this.siegeRadius = 1450;
    this.churchBellHp = this.churchBellMaxHp;

    for (const p of this.players.values()) {
      p.isPerformingMission = false;
      if (p.isWerewolf) {
        p.isTransformed = true;
        p.hasEscapePassive = false;
        // Quando o Lobisomem estilhaça o vitral da Catedral com o Escape, ele salta para os limites da floresta
        // e inicia a corrida de cerco contra os moradores no pátio da Igreja!
        const escapeSpawns = [
          { x: 680, y: 1400 },
          { x: 2100, y: 460 },
          { x: 2360, y: 2210 },
          { x: 2990, y: 1350 }
        ];
        const sp = escapeSpawns[Math.floor(Math.random() * escapeSpawns.length)];
        p.x = sp.x;
        p.y = sp.y;
        p.abilityCooldownEnd = Date.now() + 4500;
      } else if (p.isAlive) {
        // Na Lua de Sangue (Sudden Death final), a adrenalina desperta o poder de todos os moradores sobreviventes
        // para que possam defender o Sino da Igreja e enfrentar a fera!
        p.abilityUnlocked = true;
        p.missionProgress = 100;
        p.abilityCharges = Math.max(1, CLASSES_BY_ID[p.classId].maxCharges);
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
    this.postGameStartedAt = Date.now();
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
    this.checkReconnectDeadlines(now);

    if (this.phase === 'LOBBY') {
      this.evaluateLobbyReadiness();
      this.updateLobbyBotsPatrol(now);
      if (this.lobbyCountdownEndsAt !== null && now >= this.lobbyCountdownEndsAt) {
        this.launchMatchFromCurrentPlayers();
      }
      return;
    }

    if (this.phase === 'PHASE_1_HUNT') {
      const elapsedPhaseSec = (now - this.phaseStartedAt) / 1000;
      if (elapsedPhaseSec >= this.phaseDurationSec) {
        this.endMatch(
          'VILLAGE',
          'O sol nasceu após os moradores resistirem à noite inteira! O Vilarejo sobreviveu!'
        );
        return;
      }

      this.updateBarricadesProgress(now);
      this.updateAutomaticMissions(deltaMs, now);
      // Ciclo Lunar Ampliado: 75s de Lua Clara + 35s de Eclipse Lunar (110s no total)
      this.eclipseCycleTimerMs += deltaMs;
      const cyclePos = this.eclipseCycleTimerMs % FULL_LUNAR_CYCLE_MS;
      const shouldBeEclipse = cyclePos >= CLEAR_MOON_DURATION_MS;
      if (shouldBeEclipse && !this.eclipseActive) {
        this.eclipseActive = true;
        this.addLog('ECLIPSE LUNAR (35s)! A escuridão consome o vilarejo e fecha o Sino da Igreja!');
      } else if (!shouldBeEclipse && this.eclipseActive) {
        this.eclipseActive = false;
        for (const p of this.players.values()) {
          if (p.isAlive) p.totalXp += XP_REWARDS.SURVIVE_ECLIPSE;
        }
        this.addLog('A Lua Clara (75s) retorna. Sobreviventes receberam +90 XP.');
      }

      this.updateBotsAI(now);
      this.recordPositions(now);
    } else if (this.phase === 'PHASE_2_TRIBUNAL') {
      this.updateTribunalState(now);
    } else if (this.phase === 'PHASE_3_BLOOD_MOON') {
      this.updateBarricadesProgress(now);
      this.updateAutomaticMissions(deltaMs, now);
      const elapsedSec = (now - this.phaseStartedAt) / 1000;
      const progress = Math.min(1, elapsedSec / BLOOD_MOON_DURATION_SEC);
      // O círculo de cerco fecha gradualmente das bordas (1450px) até o pátio da igreja (270px)
      this.siegeRadius = Math.round(1450 - progress * (1450 - 270));

      this.updateBotsAI(now);

      if (elapsedSec >= BLOOD_MOON_DURATION_SEC) {
        if (this.churchBellHp > 0) {
          this.endMatch(
            'VILLAGE',
            'A alvorada chegou após a Lua de Sangue e o Sino da Igreja permaneceu intacto! Vitória da Vila!'
          );
        }
      }
    } else if (this.phase === 'POST_GAME') {
      // Após terminar a partida e dar tempo de girar a Roda da Vitória (15s), retorna automaticamente
      // TODOS os jogadores para a mesma sala de espera na Praça da Catedral!
      if (this.postGameStartedAt > 0 && now - this.postGameStartedAt >= 15000) {
        this.returnToLobby(true);
      }
    }
  }

  /**
   * Enquanto a sala está no LOBBY aguardando jogadores, os bots já presentes caminham pela Praça da Catedral
   * dando vida à sala de espera estilo Among Us!
   */
  private updateLobbyBotsPatrol(now: number) {
    let idx = 0;
    for (const bot of this.players.values()) {
      idx++;
      if (!bot.isBot) continue;
      const orbitAngle = ((now / 2600) + idx * 1.45) % (Math.PI * 2);
      const orbitR = 135 + (idx % 3) * 45;
      const tx = CHURCH_CENTER.x + Math.cos(orbitAngle) * orbitR;
      const ty = CHURCH_CENTER.y + Math.sin(orbitAngle) * (orbitR * 0.72);
      const dist = Math.hypot(tx - bot.x, ty - bot.y);
      if (dist > 28) {
        const angle = Math.atan2(ty - bot.y, tx - bot.x);
        this.handleMove(bot.id, Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, angle);
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
   * Move um bot até (targetX, targetY) usando roteamento inteligente pelos Nós das Trilhas da Vila Antiga
   * (ou em linha reta pela floresta densa se for o Lobisomem e não estiver atravessando o Rio Leste!).
   */
  private moveBotTowards(
    bot: PlayerState,
    targetX: number,
    targetY: number,
    cutThroughForest = false
  ) {
    let wx = targetX;
    let wy = targetY;

    const botWest = bot.x <= RIVER_LEFT_BANK;
    const targetEast = targetX > RIVER_LEFT_BANK;
    const botEast = bot.x >= 3620;
    const targetWest = targetX < 3620;

    // 1. Travessia obrigatória pela Ponte Velha do Rio (y = 1400, x = 3350..3680)
    if ((botWest && targetEast) || (botEast && targetWest)) {
      if (bot.y < 1330 || bot.y > 1470) {
        wx = botWest ? 3350 : 3680;
        wy = 1400;
      } else {
        wx = targetEast ? 3680 : 3350;
        wy = 1400;
      }
    } else if (!cutThroughForest) {
      // 2. Moradores só podem caminhar pelas Trilhas e Clareiras -> Grafo de Waypoints das Estradas da Vila
      const nodes = [
        { x: 670, y: 680 },   // 0: Lago do Poço
        { x: 1400, y: 640 },  // 1: Prado das Ovelhas
        { x: 2100, y: 460 },  // 2: Árvore Ancestral
        { x: 2850, y: 640 },  // 3: Prefeitura
        { x: 680, y: 1400 },  // 4: Cabanas da Vila
        { x: 1350, y: 1375 }, // 5: Estrada Oeste-Centro
        { x: 2100, y: 1400 }, // 6: Praça da Catedral
        { x: 2990, y: 1350 }, // 7: Cemitério
        { x: 3530, y: 1400 }, // 8: Ponte do Rio
        { x: 680, y: 2180 },  // 9: Milharal
        { x: 1560, y: 2220 }, // 10: Bosque Sul
        { x: 2360, y: 2210 }, // 11: Menires Rúnicos
        { x: 3130, y: 2170 }  // 12: Ferraria
      ];
      const edges: number[][] = [
        [1, 4],          // 0
        [0, 2],          // 1
        [1, 3, 6],       // 2
        [2, 7],          // 3
        [0, 5, 9],       // 4
        [4, 6],          // 5
        [2, 5, 7, 11],   // 6
        [3, 6, 8, 12],   // 7
        [7],             // 8
        [4, 10],         // 9
        [9, 11],         // 10
        [6, 10, 12],     // 11
        [7, 11]          // 12
      ];

      const distToTarget = Math.hypot(targetX - bot.x, targetY - bot.y);
      if (distToTarget > 380) {
        let endNode = 0;
        let minEndD = Infinity;
        for (let i = 0; i < nodes.length; i++) {
          const de = Math.hypot(nodes[i].x - targetX, nodes[i].y - targetY);
          if (de < minEndD) {
            minEndD = de;
            endNode = i;
          }
        }

        // Calcula a distância de cada nó da trilha até o destino final (endNode) usando BFS reverso a partir do destino!
        const hopsToTarget = new Array<number>(nodes.length).fill(999);
        hopsToTarget[endNode] = 0;
        const queue: number[] = [endNode];
        while (queue.length > 0) {
          const curr = queue.shift()!;
          for (const prev of edges[curr]) {
            if (hopsToTarget[prev] > hopsToTarget[curr] + 1) {
              hopsToTarget[prev] = hopsToTarget[curr] + 1;
              queue.push(prev);
            }
          }
        }

        let startNode = 0;
        let minStartD = Infinity;
        for (let i = 0; i < nodes.length; i++) {
          const ds = Math.hypot(nodes[i].x - bot.x, nodes[i].y - bot.y);
          if (ds < minStartD) {
            minStartD = ds;
            startNode = i;
          }
        }

        // Escolhe o vizinho conectado a startNode que está a MENOS saltos do destino (endNode)
        let nextNode = startNode;
        let bestHops = hopsToTarget[startNode];
        let bestEuclid = Math.hypot(nodes[startNode].x - targetX, nodes[startNode].y - targetY);

        for (const nb of edges[startNode]) {
          const nbHops = hopsToTarget[nb];
          const nbEuclid = Math.hypot(nodes[nb].x - targetX, nodes[nb].y - targetY);
          if (nbHops < bestHops || (nbHops === bestHops && nbEuclid < bestEuclid)) {
            bestHops = nbHops;
            bestEuclid = nbEuclid;
            nextNode = nb;
          }
        }

        // Assim que o bot já está alinhado no corredor da trilha atual (ou perto do nó inicial), avança direto para nextNode sem voltar para trás!
        const wp = nodes[nextNode];
        wx = wp.x;
        wy = wp.y;
      }
    }

    const angle = Math.atan2(wy - bot.y, wx - bot.x);
    this.handleMove(bot.id, Math.cos(angle), Math.sin(angle), angle);
  }

  private updateBotsAI(now: number) {
    for (const bot of this.players.values()) {
      const isAutopilotDisconnected = bot.isConnected === false;
      if (
        (!bot.isBot && !isAutopilotDisconnected) ||
        !bot.isAlive ||
        now < bot.isStunnedEnd ||
        bot.removingBarricadeId ||
        bot.hiddenInBarrelId ||
        bot.hiddenInTombId
      ) {
        continue;
      }

      // Se um bot encontrar uma Barricada de Madeira ativa bloqueando seu caminho, ele inicia a remoção de 4s!
      const blockingBarricade = this.barricades.find(
        (b) =>
          b.active &&
          !b.removingByPlayerId &&
          Math.hypot(b.x - bot.x, b.y - bot.y) <= BARRICADE_INTERACT_RADIUS - 15
      );
      if (blockingBarricade && (!bot.isWerewolf || this.phase === 'PHASE_3_BLOOD_MOON')) {
        this.handleBarricadeInteract(bot.id);
        continue;
      }

      if (this.phase === 'PHASE_3_BLOOD_MOON') {
        // Na Fase 3 (Lua de Sangue), o Lobisomem avança contra o Sino e os defensores;
        // os moradores mantêm distância tática das garras no pátio da Catedral enquanto usam habilidades e armadilhas!
        const distToChurch = Math.hypot(CHURCH_CENTER.x - bot.x, CHURCH_CENTER.y - bot.y);
        if (bot.isWerewolf) {
          const prey = this.findNearestPlayer(bot, 380);
          if (prey && Math.random() < 0.65) {
            this.moveBotTowards(bot, prey.x, prey.y, true);
          } else if (distToChurch > 95) {
            this.moveBotTowards(bot, CHURCH_CENTER.x, CHURCH_CENTER.y, true);
          }
          this.executeWerewolfAttack(bot);
        } else {
          const wolf = Array.from(this.players.values()).find((w) => w.isAlive && w.isWerewolf);
          const distToWolf = wolf ? Math.hypot(wolf.x - bot.x, wolf.y - bot.y) : 999;

          if (distToWolf < 145 && wolf) {
            // Se o Lobo está colado, tenta atordoar/bater nele ou recua mantendo-se dentro do círculo de fogo!
            if (bot.abilityUnlocked && bot.abilityCharges > 0) {
              this.handleUseAbility(bot.id);
            }
            const fleeAngle = Math.atan2(bot.y - wolf.y, bot.x - wolf.x);
            const fx = CHURCH_CENTER.x + Math.cos(fleeAngle) * Math.min(230, this.siegeRadius - 35);
            const fy = CHURCH_CENTER.y + Math.sin(fleeAngle) * Math.min(200, this.siegeRadius - 35);
            this.moveBotTowards(bot, fx, fy, false);
          } else {
            const orbitAngle = ((now / 900) + bot.id.charCodeAt(4) * 1.3) % (Math.PI * 2);
            const orbitR = Math.min(185, Math.max(85, this.siegeRadius * 0.45));
            const ox = CHURCH_CENTER.x + Math.cos(orbitAngle) * orbitR;
            const oy = CHURCH_CENTER.y + Math.sin(orbitAngle) * orbitR;
            this.moveBotTowards(bot, ox, oy, false);

            if (
              bot.abilityUnlocked &&
              bot.abilityCharges > 0 &&
              (bot.classId === 'cacador' ||
                bot.classId === 'ferreira_armadilhas' ||
                bot.classId === 'freira' ||
                bot.classId === 'bardo') &&
              Math.random() < 0.08
            ) {
              this.handleUseAbility(bot.id);
            }
          }
        }
        continue;
      }

      // Fase 1: Se um bot morador encontrar um cadáver não reportado por perto, ele reporta e convoca o Tribunal!
      if (!bot.isWerewolf) {
        const nearbyCorpse = this.corpses.find(
          (c) => !c.reported && Math.hypot(c.x - bot.x, c.y - bot.y) <= 210
        );
        if (nearbyCorpse && Math.random() < 0.65) {
          this.handleReportOrBell(bot.id);
          return;
        }
      }

      // Fase 1: Bots moradores vão até a zona da missão de sua classe (e ficam lá até carregar 100%!)
      if (!bot.isWerewolf) {
        const cls = CLASSES_BY_ID[bot.classId];
        const zone = VILLAGE_ZONES.find((z) => z.id === cls.missionZone);
        if (zone) {
          const tx = zone.x + zone.width / 2;
          const ty = zone.y + zone.height / 2;
          const dist = Math.hypot(tx - bot.x, ty - bot.y);
          if (!bot.abilityUnlocked) {
            if (dist > 70) {
              this.moveBotTowards(bot, tx, ty);
            }
            // Quando já está dentro da zona (dist <= 70), permanece no local para updateAutomaticMissions carregar até 100%!
          } else {
            // Habilidade já liberada -> Patrulha pelas trilhas da vila e usa habilidades táticas
            const patrolTargets = [
              CHURCH_CENTER,
              { x: 680, y: 1400 },
              { x: 2990, y: 1330 },
              { x: 2100, y: 460 },
              { x: 2360, y: 2210 }
            ];
            const pickIdx = Math.floor(((now / 7000) + bot.id.charCodeAt(4)) % patrolTargets.length);
            const pt = patrolTargets[pickIdx];
            this.moveBotTowards(bot, pt.x, pt.y);

            if (
              (bot.classId === 'cacador' ||
                bot.classId === 'ferreira_armadilhas' ||
                bot.classId === 'freira' ||
                bot.classId === 'bardo' ||
                bot.classId === 'pastor') &&
              bot.abilityCharges > 0 &&
              Math.random() < 0.045
            ) {
              this.handleUseAbility(bot.id);
            } else if (
              (bot.classId === 'inquisidor' ||
                bot.classId === 'lenhador' ||
                bot.classId === 'padre') &&
              bot.abilityCharges > 0
            ) {
              // Se o bot Inquisidor, Lenhador ou Padre avistar o Lobisomem TRANSFORMADO ou REVELADO por perto, usa sua habilidade na hora!
              const visibleWolf = Array.from(this.players.values()).find(
                (other) =>
                  other.id !== bot.id &&
                  other.isAlive &&
                  other.isWerewolf &&
                  (other.isTransformed || now < other.isRevealedEnd) &&
                  Math.hypot(other.x - bot.x, other.y - bot.y) <= 175
              );
              if (visibleWolf) {
                this.handleUseAbility(bot.id);
              }
            }
          }
        }
      } else {
        // Bot Lobisomem: prioriza destruir os 2 Totens Rúnicos mais próximos para ativar o ESCAPE
        // antes de iniciar a caçada letal (garantindo sobrevivência contra o Tribunal e o Caçador!)
        const availableTotems = this.totems.filter((t) => !t.destroyed);
        if (availableTotems.length > 0 && !bot.hasEscapePassive) {
          availableTotems.sort(
            (a, b) => Math.hypot(a.x - bot.x, a.y - bot.y) - Math.hypot(b.x - bot.x, b.y - bot.y)
          );
          const targetTotem = availableTotems[0];
          this.moveBotTowards(bot, targetTotem.x, targetTotem.y, true);
          if (Math.hypot(targetTotem.x - bot.x, targetTotem.y - bot.y) <= 98) {
            this.handleMissionInteract(bot.id);
          }
        } else {
          const prey = this.findNearestPlayer(bot, 4500);
          if (prey) {
            const distToPrey = Math.hypot(prey.x - bot.x, prey.y - bot.y);
            this.moveBotTowards(bot, prey.x, prey.y, bot.isTransformed);
            if (distToPrey <= 145 && !bot.isTransformed && isPlayerInCover(bot.x, bot.y)) {
              bot.isTransformed = true;
            }
            if (distToPrey <= 102) {
              if (!bot.isTransformed && isPlayerInCover(bot.x, bot.y)) {
                bot.isTransformed = true;
              }
              if (bot.isTransformed) {
                const res = this.executeWerewolfAttack(bot);
                // Após abater uma presa na Fase 1, volta ao disfarce humano para fugir sem ser baleado pelo Inquisidor!
                if (res.ok && this.phase === 'PHASE_1_HUNT') {
                  bot.isTransformed = false;
                }
              }
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

    const cyclePos = this.eclipseCycleTimerMs % FULL_LUNAR_CYCLE_MS;
    const eclipseRemainingSec = this.eclipseActive
      ? Math.max(0, Math.ceil((FULL_LUNAR_CYCLE_MS - cyclePos) / 1000))
      : Math.max(0, Math.ceil((CLEAR_MOON_DURATION_MS - cyclePos) / 1000));

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

    const lobbyCountdownSec =
      this.phase === 'LOBBY' && this.lobbyCountdownEndsAt !== null
        ? Math.max(0, Math.ceil((this.lobbyCountdownEndsAt - now) / 1000))
        : null;

    return {
      roomId: this.roomId,
      roomName: this.roomName,
      regionLabel: this.regionLabel,
      requiredPlayers: this.requiredPlayers,
      maxPlayers: this.maxPlayers,
      lobbyCountdownSec,
      lobbyChatMessages: this.lobbyChatMessages,
      phase: this.phase,
      phaseTimerSec:
        this.phase === 'PHASE_2_TRIBUNAL' && this.tribunal
          ? Math.max(0, Math.ceil((this.tribunal.turnEndsAt - now) / 1000))
          : phaseTimerSec,
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
      hunterRelic: this.hunterRelic,
      tribunal: this.tribunal,
      winner: this.winner,
      winReason: this.winReason,
      killFeed: this.killFeed
    };
  }
}
