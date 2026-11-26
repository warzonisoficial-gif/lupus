import {
  BarricadeEntity,
  BarricadeSlot,
  HidingBarrel,
  MapZone,
  TotemPoint,
  WerewolfTomb
} from './types';

export const MAP_WIDTH = 4200;
export const MAP_HEIGHT = 2800;

export const CHURCH_CENTER = { x: 2100, y: 1400 };
export const BELL_INTERACT_RADIUS = 130;

export const RIVER_LEFT_BANK = 3440;
export const RIVER_RIGHT_BANK = 3620;
export const BRIDGE_WALK_TOP = 1280;
export const BRIDGE_WALK_BOTTOM = 1520;

/**
 * MECÂNICA EXCLUSIVA 1: Lago Raso / Pântano do Poço (Noroeste)
 * Os jogadores PODEM entrar nessa água rasa para alcançar a ilhota do Poço,
 * mas caminham 45% mais devagar dentro da água!
 */
export const SHALLOW_LAKE_ZONE = {
  x: 340,
  y: 440,
  width: 660,
  height: 480,
  centerX: 670,
  centerY: 680,
  rx: 320,
  ry: 230
};

/**
 * MECÂNICA EXCLUSIVA 2: A Grande Árvore Ancestral (Bosque Norte)
 * Uma única Árvore Milenar de copa gigantesca no centro do território norte:
 * quem entra debaixo do raio da copa (175px) fica 100% oculto sob os galhos!
 */
export const GIANT_ANCIENT_TREE = {
  x: 2100,
  y: 460,
  canopyRadius: 175
};

/**
 * MECÂNICA EXCLUSIVA 3: Passagem Secreta Escura EMBAIXO da Ponte do Rio (Leste)
 * Ao passar na faixa central sob a estrutura da ponte, o jogador fica oculto nas sombras da ponte!
 */
export const UNDER_BRIDGE_SHADOW = {
  x: 3420,
  y: 1340,
  width: 220,
  height: 120
};

/**
 * MECÂNICA EXCLUSIVA 4: O Barril de Esconderijo (Apenas 1 barril exclusivo no centro das Cabanas da Vila!)
 */
export const HIDING_BARRELS: HidingBarrel[] = [
  { id: 'barrel_cabin_1', sectorName: 'Cabanas da Vila', x: 650, y: 1400 }
];

export const BARREL_INTERACT_RADIUS = 95;

/**
 * MECÂNICA EXCLUSIVA 5: Tumbas / Sarcófagos do Cemitério (Exclusivos para o Lobisomem se esconder e emboscar!)
 */
export const WEREWOLF_TOMBS: WerewolfTomb[] = [
  { id: 'tomb_cemetery_crypt_1', name: 'Tumba Antiga Norte', x: 2990, y: 1180 },
  { id: 'tomb_cemetery_crypt_2', name: 'Tumba Antiga Sul', x: 2990, y: 1470 }
];

export const TOMB_INTERACT_RADIUS = 105;

/**
 * MECÂNICA EXCLUSIVA 6: Pontos de Passagem entre os Territórios onde o Lobisomem pode
 * colocar Barricadas de Madeira impedindo a passagem!
 * Qualquer jogador pode remover, porém demora 4 segundos travado sem poder cancelar!
 */
export const BARRICADE_SLOTS: BarricadeSlot[] = [
  { id: 'bar_west_road', name: 'Passagem Oeste (Cabanas <-> Catedral)', x: 1260, y: 1380, orientation: 'VERTICAL' },
  { id: 'bar_north_road', name: 'Passagem Norte (Árvore <-> Catedral)', x: 2085, y: 880, orientation: 'HORIZONTAL' },
  { id: 'bar_east_road', name: 'Passagem Leste (Catedral <-> Cemitério)', x: 2540, y: 1380, orientation: 'VERTICAL' },
  { id: 'bar_south_road', name: 'Passagem Sul (Catedral <-> Menires)', x: 2180, y: 1810, orientation: 'HORIZONTAL' },
  { id: 'bar_nw_lake', name: 'Passagem do Lago (Poço <-> Cabanas)', x: 665, y: 1030, orientation: 'HORIZONTAL' },
  { id: 'bar_sw_corn', name: 'Passagem do Milharal (Cabanas <-> Milharal)', x: 680, y: 1760, orientation: 'HORIZONTAL' },
  { id: 'bar_se_forge', name: 'Passagem da Forja (Menires <-> Ferraria)', x: 2740, y: 2190, orientation: 'VERTICAL' },
  { id: 'bar_bridge_entry', name: 'Entrada da Ponte do Rio', x: 3360, y: 1400, orientation: 'VERTICAL' }
];

export const BARRICADE_INTERACT_RADIUS = 135;
export const BARRICADE_BLOCK_RADIUS = 78;
export const BARRICADE_REMOVE_DURATION_MS = 4000;

/**
 * 12 Territórios Amplos e Orgânicos do Vilarejo (650px a 850px cada!).
 * Cada território tem visual próprio e 1 elemento/mecânica única que não se repete nos outros!
 */
export const VILLAGE_ZONES: MapZone[] = [
  {
    id: 'igreja',
    name: 'Praça da Catedral & Sino',
    x: 1680,
    y: 1060,
    width: 840,
    height: 680,
    isCoverZone: false,
    isNeutralCenter: true,
    color: 0x334155,
    description: 'Coração da Vila. Praça ampla com a Catedral Antiga e o Sino Sagrado.'
  },
  {
    id: 'poco_distante',
    name: 'Lago Raso do Poço Antigo',
    x: 320,
    y: 380,
    width: 700,
    height: 580,
    isCoverZone: false,
    color: 0x1e3a8a,
    description: 'Lago raso alagado: entrar na água reduz a velocidade em 45% até a ilhota do Poço.'
  },
  {
    id: 'pastagem',
    name: 'Prado das Ovelhas',
    x: 1120,
    y: 380,
    width: 560,
    height: 520,
    isCoverZone: false,
    color: 0x14532d,
    description: 'Campos verdes abertos com rebanho de ovelhas e fardos gigantes de feno.'
  },
  {
    id: 'cedros_norte',
    name: 'Santuário da Árvore Ancestral',
    x: 1760,
    y: 180,
    width: 680,
    height: 560,
    isCoverZone: true,
    color: 0x064e3b,
    description: 'Abriga a Grande Árvore Milenar: entrar sob sua copa gigante oculta totalmente o jogador.'
  },
  {
    id: 'prefeitura',
    name: 'Solar da Prefeitura',
    x: 2540,
    y: 380,
    width: 620,
    height: 520,
    isCoverZone: false,
    color: 0x374151,
    description: 'Pátio calçado de pedra com os arquivos reais, bancos e braseiros.'
  },
  {
    id: 'cemiterio',
    name: 'Cemitério das Brumas',
    x: 2660,
    y: 1040,
    width: 660,
    height: 580,
    isCoverZone: true,
    color: 0x1e293b,
    description: 'Cercado por madeira antiga, coberto por névoa baixa e lápides góticas.'
  },
  {
    id: 'ponte_madeira',
    name: 'Rio Profundo & Ponte Velha',
    x: 3320,
    y: 1120,
    width: 720,
    height: 560,
    isCoverZone: true,
    color: 0x451a03,
    description: 'Única travessia sobre o Rio Leste, com sombra oculta sob as vigas da ponte.'
  },
  {
    id: 'casas_perifericas',
    name: 'Vila das Cabanas & Barris',
    x: 320,
    y: 1100,
    width: 720,
    height: 600,
    isCoverZone: true,
    color: 0x3f3f46,
    description: 'Acampamento de cabanas de toras e palha. Único local com Barris de Esconderijo!'
  },
  {
    id: 'milharal',
    name: 'Fazenda do Milharal Alto',
    x: 320,
    y: 1860,
    width: 760,
    height: 660,
    isCoverZone: true,
    color: 0x713f12,
    description: 'Plantação densa e alta de milho que esconde qualquer jogador que entrar nela.'
  },
  {
    id: 'cedros_sul',
    name: 'Bosque de Caça do Sul',
    x: 1220,
    y: 1920,
    width: 680,
    height: 600,
    isCoverZone: true,
    color: 0x064e3b,
    description: 'Mata sul de cedros e troncos caídos onde o Caçador rastreia a fera.'
  },
  {
    id: 'pedras_antigas',
    name: 'Círculo de Menires Rúnicos',
    x: 2040,
    y: 1920,
    width: 640,
    height: 580,
    isCoverZone: true,
    color: 0x312e81,
    description: 'Anel místico de pedras antigas que concede +22% de velocidade espiritual no seu interior.'
  },
  {
    id: 'ferraria',
    name: 'Forja Vulcânica da Ferraria',
    x: 2820,
    y: 1860,
    width: 620,
    height: 620,
    isCoverZone: false,
    color: 0x7c2d12,
    description: 'Pátio de ardósia aquecido por fornalhas incandescentes, bigornas e armas de prata.'
  }
];

export const INITIAL_RUNIC_TOTEMS: TotemPoint[] = [
  { id: 'totem_nw', name: 'Totem Rúnico Noroeste', x: 240, y: 260, destroyed: false },
  { id: 'totem_ne', name: 'Totem Rúnico Nordeste', x: 3860, y: 340, destroyed: false },
  { id: 'totem_sw', name: 'Totem Rúnico Sudoeste', x: 240, y: 2620, destroyed: false },
  { id: 'totem_se', name: 'Totem Rúnico Sudeste', x: 3860, y: 2520, destroyed: false }
];

/**
 * Trilhas e Estradas Orgânicas que interligam as 12 Clareiras da Vila.
 * Os personagens SÓ podem caminhar dentro das Clareiras (VILLAGE_ZONES) e ao longo destas Trilhas
 * (não é permitido cortar caminho pelo meio da floresta fora dos caminhos!).
 */
export interface TrailSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  radius: number; // Meio-diâmetro caminhável da estrada
}

export const VILLAGE_TRAIL_POLYLINE_LIST: { points: { x: number; y: number }[]; radius: number }[] = [
  // 1. Estrada Horizontal Central (Cabanas <-> Catedral <-> Cemitério <-> Ponte do Rio)
  {
    points: [
      { x: 680, y: 1400 },
      { x: 1350, y: 1375 },
      { x: 2100, y: 1400 },
      { x: 2980, y: 1365 },
      { x: 3750, y: 1400 }
    ],
    radius: 95
  },
  // 2. Estrada Vertical Central (Árvore Ancestral <-> Catedral <-> Círculo de Menires)
  {
    points: [
      { x: 2100, y: 460 },
      { x: 2085, y: 920 },
      { x: 2100, y: 1400 },
      { x: 2180, y: 1820 },
      { x: 2360, y: 2210 }
    ],
    radius: 92
  },
  // 3. Trilha Oeste (Lago do Poço <-> Cabanas <-> Milharal)
  {
    points: [
      { x: 670, y: 680 },
      { x: 665, y: 1050 },
      { x: 680, y: 1400 },
      { x: 680, y: 2180 }
    ],
    radius: 86
  },
  // 4. Trilha Norte (Lago do Poço <-> Prado das Ovelhas <-> Árvore Ancestral <-> Prefeitura <-> Cemitério)
  {
    points: [
      { x: 670, y: 680 },
      { x: 1400, y: 640 },
      { x: 2100, y: 460 },
      { x: 2850, y: 640 },
      { x: 2990, y: 1330 }
    ],
    radius: 85
  },
  // 5. Trilha Sul (Milharal <-> Bosque do Sul <-> Menires Rúnicos <-> Ferraria <-> Cemitério)
  {
    points: [
      { x: 680, y: 2180 },
      { x: 1560, y: 2220 },
      { x: 2360, y: 2210 },
      { x: 3130, y: 2170 },
      { x: 2990, y: 1330 }
    ],
    radius: 86
  },
  // 6. Trilhas curtas até os 4 Totens Rúnicos nos cantos da floresta
  {
    points: [
      { x: 670, y: 680 },
      { x: 240, y: 260 }
    ],
    radius: 75
  },
  {
    points: [
      { x: 2850, y: 640 },
      { x: 3400, y: 480 }
    ],
    radius: 75
  },
  {
    points: [
      { x: 680, y: 2180 },
      { x: 240, y: 2620 }
    ],
    radius: 75
  },
  {
    points: [
      { x: 3700, y: 1400 },
      { x: 3860, y: 340 }
    ],
    radius: 78
  },
  {
    points: [
      { x: 3700, y: 1400 },
      { x: 3860, y: 2520 }
    ],
    radius: 78
  }
];

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);
  return Math.hypot(px - projX, py - projY);
}

/**
 * Verifica se (x, y) está dentro de uma Clareira de Território ou sobre uma das Trilhas/Caminhos!
 * Se estiver fora dos caminhos e fora das clareiras (tentando cortar caminho pelo mato), retorna false!
 */
export function isOnPathOrClearing(x: number, y: number): boolean {
  // 1. Verifica se está dentro da elipse suave de algum dos 12 Territórios (Clareiras)
  for (const z of VILLAGE_ZONES) {
    const cx = z.x + z.width / 2;
    const cy = z.y + z.height / 2;
    const rx = z.width * 0.48;
    const ry = z.height * 0.48;
    const normDist = ((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry);
    if (normDist <= 1) {
      return true;
    }
  }

  // 2. Verifica se está sobre qualquer uma das Trilhas / Caminhos da Vila
  for (const poly of VILLAGE_TRAIL_POLYLINE_LIST) {
    for (let i = 0; i < poly.points.length - 1; i++) {
      const p1 = poly.points[i];
      const p2 = poly.points[i + 1];
      if (distToSegment(x, y, p1.x, p1.y, p2.x, p2.y) <= poly.radius) {
        return true;
      }
    }
  }

  return false;
}

export function isPointInZone(x: number, y: number, zone: MapZone): boolean {
  return x >= zone.x && x <= zone.x + zone.width && y >= zone.y && y <= zone.y + zone.height;
}

/**
 * Verifica se o jogador está dentro da água do Lago Raso do Poço (reduz velocidade em 45%)
 */
export function isPointInShallowLake(x: number, y: number): boolean {
  const dx = (x - SHALLOW_LAKE_ZONE.centerX) / SHALLOW_LAKE_ZONE.rx;
  const dy = (y - SHALLOW_LAKE_ZONE.centerY) / SHALLOW_LAKE_ZONE.ry;
  const distSq = dx * dx + dy * dy;
  // Ilhota seca central do poço (raio ~75px) não desacelera; o anel de água ao redor desacelera!
  const distFromCenter = Math.hypot(x - SHALLOW_LAKE_ZONE.centerX, y - SHALLOW_LAKE_ZONE.centerY);
  return distSq <= 1 && distFromCenter > 72;
}

/**
 * Verifica se o jogador está no interior energizado do Círculo de Pedras Rúnicas (+22% velocidade)
 */
export function isPointInRunicCircle(x: number, y: number): boolean {
  return Math.hypot(x - 2360, y - 2210) <= 165;
}

/**
 * Verifica se o ponto está no Solo Sagrado próximo à Igreja Central:
 * O Lobisomem anda 38% mais devagar quando pisa perto da Igreja!
 */
export function isPointInChurchSacredGround(x: number, y: number): boolean {
  const dx = (x - CHURCH_CENTER.x) / 435;
  const dy = (y - CHURCH_CENTER.y) / 345;
  return dx * dx + dy * dy <= 1;
}

/**
 * Verifica se o boneco do jogador deve ficar oculto pelo cenário:
 * 1. Dentro do Milharal Alto (Fazenda Sudoeste)
 * 2. Debaixo da Copa Gigante da Grande Árvore Ancestral (Norte)
 * 3. Debaixo dos Cedros Fechados do Bosque de Caça (Sul)
 * 4. Embaixo das vigas escuras da Ponte de Madeira sobre o Rio (Leste)
 */
export function isPlayerHiddenByEnvironment(x: number, y: number): boolean {
  // 1. Debaixo da Copa da Grande Árvore Ancestral
  if (
    Math.hypot(x - GIANT_ANCIENT_TREE.x, y - GIANT_ANCIENT_TREE.y) <=
    GIANT_ANCIENT_TREE.canopyRadius
  ) {
    return true;
  }

  // 2. Dentro da plantação do Milharal Alto
  const cornZone = VILLAGE_ZONES.find((z) => z.id === 'milharal');
  if (
    cornZone &&
    x >= cornZone.x + 35 &&
    x <= cornZone.x + cornZone.width - 35 &&
    y >= cornZone.y + 45 &&
    y <= cornZone.y + cornZone.height - 35
  ) {
    return true;
  }

  // 3. Debaixo do dossel central do Bosque de Caça do Sul
  const southWoods = VILLAGE_ZONES.find((z) => z.id === 'cedros_sul');
  if (
    southWoods &&
    x >= southWoods.x + 60 &&
    x <= southWoods.x + southWoods.width - 60 &&
    y >= southWoods.y + 70 &&
    y <= southWoods.y + southWoods.height - 60
  ) {
    return true;
  }

  // 4. Sombra embaixo da Ponte do Rio
  if (
    x >= UNDER_BRIDGE_SHADOW.x &&
    x <= UNDER_BRIDGE_SHADOW.x + UNDER_BRIDGE_SHADOW.width &&
    y >= UNDER_BRIDGE_SHADOW.y &&
    y <= UNDER_BRIDGE_SHADOW.y + UNDER_BRIDGE_SHADOW.height
  ) {
    return true;
  }

  return false;
}

export function isPlayerInCover(x: number, y: number): boolean {
  return (
    isPlayerHiddenByEnvironment(x, y) ||
    VILLAGE_ZONES.some((z) => z.isCoverZone && isPointInZone(x, y, z))
  );
}

/**
 * Resolve colisão natural do Vilarejo:
 * 1. O Rio Profundo a Leste só pode ser atravessado pela Ponte de Madeira.
 * 2. Os Bosques Naturais Redondos (NATURAL_FOREST_CLUSTERS) entre os territórios empurram suavemente o jogador ao redor.
 */
export function resolveMapCollisions(
  prevX: number,
  prevY: number,
  targetX: number,
  targetY: number,
  activeBarricades?: BarricadeEntity[]
): { x: number; y: number } {
  let nx = Math.max(70, Math.min(MAP_WIDTH - 70, targetX));
  let ny = Math.max(70, Math.min(MAP_HEIGHT - 60, targetY));

  // 1. Colisão com o Rio Profundo (x: 3440..3620), liberando apenas a travessia pela Ponte (y: 1280..1520)
  const isInRiverX = (x: number) => x > RIVER_LEFT_BANK && x < RIVER_RIGHT_BANK;
  const isOnBridgeY = (y: number) => y >= BRIDGE_WALK_TOP && y <= BRIDGE_WALK_BOTTOM;

  if (isInRiverX(nx) && !isOnBridgeY(ny)) {
    if (isInRiverX(prevX) && isOnBridgeY(prevY)) {
      ny =
        prevY < (BRIDGE_WALK_TOP + BRIDGE_WALK_BOTTOM) / 2
          ? BRIDGE_WALK_TOP
          : BRIDGE_WALK_BOTTOM;
    } else {
      nx = prevX <= RIVER_LEFT_BANK + 18 ? RIVER_LEFT_BANK : RIVER_RIGHT_BANK;
    }
  }

  // 2. Proíbe cortar caminho fora das Trilhas e Clareiras (com deslizamento suave acompanhando a curva da trilha!)
  if (!isOnPathOrClearing(nx, ny)) {
    if (isOnPathOrClearing(nx, prevY)) {
      ny = prevY;
    } else if (isOnPathOrClearing(prevX, ny)) {
      nx = prevX;
    } else {
      // Testa pequenos ângulos laterais para deslizar suavemente em trilhas diagonais/curvas
      const moveDist = Math.hypot(nx - prevX, ny - prevY);
      const baseAngle = Math.atan2(ny - prevY, nx - prevX);
      let slid = false;
      for (const offset of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05]) {
        const testX = prevX + Math.cos(baseAngle + offset) * moveDist * 0.85;
        const testY = prevY + Math.sin(baseAngle + offset) * moveDist * 0.85;
        if (isOnPathOrClearing(testX, testY)) {
          nx = testX;
          ny = testY;
          slid = true;
          break;
        }
      }
      if (!slid && isOnPathOrClearing(prevX, prevY)) {
        nx = prevX;
        ny = prevY;
      }
    }
  }

  // 3. Colisão Física com as Barricadas de Madeira ativas colocadas pelo Lobisomem!
  if (activeBarricades) {
    for (const bar of activeBarricades) {
      if (!bar.active) continue;
      const halfW = bar.orientation === 'HORIZONTAL' ? 105 : 46;
      const halfH = bar.orientation === 'HORIZONTAL' ? 46 : 105;

      const insideNow =
        Math.abs(nx - bar.x) < halfW && Math.abs(ny - bar.y) < halfH;
      if (insideNow) {
        if (bar.orientation === 'HORIZONTAL') {
          ny = prevY < bar.y ? bar.y - halfH : bar.y + halfH;
        } else {
          nx = prevX < bar.x ? bar.x - halfW : bar.x + halfW;
        }
      }
    }
  }

  return { x: nx, y: ny };
}
