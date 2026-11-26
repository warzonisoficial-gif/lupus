export type GamePhase =
  | 'LOBBY'
  | 'PHASE_1_HUNT'
  | 'PHASE_2_TRIBUNAL'
  | 'PHASE_3_BLOOD_MOON'
  | 'POST_GAME';

export type TribunalTurn = 'TURN_1_SECRET_VOTE' | 'TURN_2_DEFENSE' | 'TURN_3_FINAL_VERDICT';

export type ClassId =
  | 'aldeao'
  | 'lenhador'
  | 'marceneiro'
  | 'cacador'
  | 'freira'
  | 'padre'
  | 'sacerdote'
  | 'ferreiro'
  | 'boticario'
  | 'coveiro'
  | 'pastor'
  | 'ferreira_armadilhas'
  | 'vigia_noturno'
  | 'cartografo'
  | 'bardo'
  | 'juiz'
  | 'medium'
  | 'alquimista'
  | 'prefeito'
  | 'inquisidor';

export type ZoneId =
  | 'igreja'
  | 'cedros_norte'
  | 'cedros_sul'
  | 'milharal'
  | 'ponte_madeira'
  | 'casas_perifericas'
  | 'cemiterio'
  | 'poco_distante'
  | 'ferraria'
  | 'pastagem'
  | 'pedras_antigas'
  | 'prefeitura';

export interface ClassDefinition {
  id: ClassId;
  order: number;
  name: string;
  roleTitle: string;
  unlimitedInRoom: boolean;
  requiredXp: number;
  requiredLevel: number;
  missionZone: ZoneId;
  missionTitle: string;
  missionDurationMs: number;
  abilityName: string;
  abilityDescription: string;
  cooldownMs: number;
  maxCharges: number;
  colorHex: string;
}

export interface MapZone {
  id: ZoneId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isCoverZone: boolean; // Permite transformação oculta do Lobisomem e reduz visão
  isNeutralCenter?: boolean;
  color: number;
  description: string;
}

export interface TotemPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  destroyed: boolean;
}

export interface HidingBarrel {
  id: string;
  sectorName: string;
  x: number;
  y: number;
}

export interface WerewolfTomb {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface BarricadeSlot {
  id: string;
  name: string;
  x: number;
  y: number;
  orientation: 'HORIZONTAL' | 'VERTICAL';
}

export interface BarricadeEntity {
  slotId: string;
  x: number;
  y: number;
  orientation: 'HORIZONTAL' | 'VERTICAL';
  active: boolean;
  removingByPlayerId: string | null;
  removeStartedAt: number;
  removeEndsAt: number;
}

export interface TrapEntity {
  id: string;
  ownerId: string;
  type: 'HUNTER_LETHAL' | 'BEAR_STUN';
  x: number;
  y: number;
  triggered: boolean;
}

export interface CorpseEntity {
  id: string;
  victimId: string;
  victimName: string;
  victimClass: ClassId;
  x: number;
  y: number;
  diedAt: number;
  escapeDirection: string;
  nearbySuspects: string[]; // Nomes que passaram nos últimos 15s
  reported: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  classId: ClassId;
  isWerewolf: boolean;
  isTransformed: boolean;
  isAlive: boolean;
  x: number;
  y: number;
  facingAngle: number;
  missionProgress: number; // 0 a 100
  abilityUnlocked: boolean;
  abilityCharges: number;
  abilityCooldownEnd: number;
  hasBlessingShield: boolean;
  hasClarityBuffEnd: number;
  hasSpeedBuffEnd: number;
  isInvisibleEnd: number;
  isStunnedEnd: number;
  isRevealedEnd: number;
  hiddenInBarrelId: string | null; // ID do barril onde o jogador está escondido
  usedBarrelIds: string[];         // IDs dos barris/baús nos quais o jogador já entrou nesta partida (não pode entrar de novo no mesmo!)
  hiddenInTombId: string | null;   // ID da tumba do cemitério onde o Lobisomem está escondido
  removingBarricadeId: string | null; // ID da barricada que o jogador está removendo (4s incancelável!)
  removingBarricadeEndsAt: number;
  barricadeCooldownEnd: number;
  // Específicos do Lobisomem
  totemsDestroyed: number;
  hasEscapePassive: boolean;
  leapCooldownEnd: number;
  // Progresso de Conta
  totalXp: number;
}

export interface TribunalState {
  active: boolean;
  turn: TribunalTurn;
  turnEndsAt: number;
  reporterName: string;
  reason: string;
  corpseLocation?: { x: number; y: number; victimName: string };
  suspectClues: string[];
  turn1VotesCount: number;
  finalists: [string, string] | null; // IDs dos 2 mais votados
  finalVerdictCounts?: {
    executeA: number;
    executeB: number;
    absolve: number;
  };
  outcomeBanner?: string;
}

export interface WorldSnapshot {
  roomId: string;
  phase: GamePhase;
  phaseTimerSec: number;
  eclipseActive: boolean;
  eclipseRemainingSec: number;
  siegeRadius: number; // Círculo fechando na Fase 3 (de 1600 até 320)
  churchBellHp: number;
  churchBellMaxHp: number;
  players: PlayerState[];
  totems: TotemPoint[];
  traps: TrapEntity[];
  corpses: CorpseEntity[];
  barricades: BarricadeEntity[];
  tribunal: TribunalState | null;
  winner: 'VILLAGE' | 'WEREWOLF' | null;
  winReason: string | null;
  killFeed: { id: string; text: string; timestamp: number }[];
}
