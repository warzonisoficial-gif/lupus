import { CLASSES_LIST } from './classesData';
import { ClassDefinition } from './types';

export const MAX_ACCOUNT_LEVEL = 100;
export const MAX_ACCOUNT_XP = 1_000_000;

export const XP_REWARDS = {
  MISSION_COMPLETED: 120,
  SURVIVE_ECLIPSE: 90,
  CORRECT_TRIBUNAL_VOTE: 180,
  TRAP_OR_STUN_WEREWOLF: 220,
  WEREWOLF_SOLO_VICTORY: 1000,
  WHEEL_GOLDEN_ZONE: 1000, // 5% da roleta
  WHEEL_GOOD_ZONE: 450,    // 25% da roleta
  WHEEL_MISS_ZONE: 150     // 70% da roleta
};

/**
 * Calcula o nível atual (1 a 100) com base no XP acumulado (0 a 1.000.000 XP).
 * Curva polinomial calibrada para liberar o Lenhador em 1.500 XP (~3 partidas)
 * e atingir o nível 100 em 1.000.000 XP.
 */
export function getAccountLevelFromXp(xp: number): number {
  if (xp <= 0) return 1;
  if (xp >= MAX_ACCOUNT_XP) return MAX_ACCOUNT_LEVEL;
  const normalized = Math.pow(xp / MAX_ACCOUNT_XP, 0.56);
  return Math.max(1, Math.min(MAX_ACCOUNT_LEVEL, Math.floor(normalized * 99) + 1));
}

export function getXpForAccountLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= MAX_ACCOUNT_LEVEL) return MAX_ACCOUNT_XP;
  return Math.round(Math.pow((level - 1) / 99, 1 / 0.56) * MAX_ACCOUNT_XP);
}

export function getUnlockedClasses(xp: number): ClassDefinition[] {
  return CLASSES_LIST.filter((c) => xp >= c.requiredXp);
}

export function getNextLockedClass(xp: number): ClassDefinition | null {
  return CLASSES_LIST.find((c) => xp < c.requiredXp) || null;
}

/**
 * Avalia o resultado do Skill Check da Roda da Vitória (ângulo normalizado de 0 a 360 graus)
 * - Zona Dourada (5% = 18 graus, centrada em 0°/360°: de 351° a 9°) -> +1.000 XP
 * - Zona Boa (25% = 90 graus ao redor da dourada: de 315° a 351° e 9° a 45°) -> +450 XP
 * - Restante -> +150 XP
 */
export function evaluateVictoryWheelAngle(angleDeg: number): {
  tier: 'GOLDEN' | 'GOOD' | 'MISS';
  xpEarned: number;
  label: string;
} {
  const norm = ((angleDeg % 360) + 360) % 360;
  const distFromTop = Math.min(norm, 360 - norm);

  if (distFromTop <= 9) {
    return {
      tier: 'GOLDEN',
      xpEarned: XP_REWARDS.WHEEL_GOLDEN_ZONE,
      label: 'ZONA DOURADA (5%)! +1.000 XP'
    };
  }
  if (distFromTop <= 54) {
    return {
      tier: 'GOOD',
      xpEarned: XP_REWARDS.WHEEL_GOOD_ZONE,
      label: 'ZONA BOA (25%)! +450 XP'
    };
  }
  return {
    tier: 'MISS',
    xpEarned: XP_REWARDS.WHEEL_MISS_ZONE,
    label: 'GIRO PADRÃO: +150 XP'
  };
}
