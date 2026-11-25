import Phaser from 'phaser';
import { CLASSES_LIST } from '../shared/classesData';
import {
  CHURCH_CENTER,
  GIANT_ANCIENT_TREE,
  MAP_HEIGHT,
  MAP_WIDTH,
  RIVER_LEFT_BANK,
  RIVER_RIGHT_BANK,
  SHALLOW_LAKE_ZONE,
  VILLAGE_TRAIL_POLYLINE_LIST,
  VILLAGE_ZONES,
  isOnPathOrClearing
} from '../shared/mapData';
import { ClassId } from '../shared/types';

/**
 * Motor de Arte Vetorial 2.5D (Perspectiva 3/4 Cel-Shaded estilo Among Us / Town of Salem 2 / Cult of the Lamb).
 * - Personagens vistos de frente/3/4 com corpo inteiro, roupas detalhadas, rosto expressivo, olhos brilhantes,
 *   chapéus/acessórios exclusivos para cada uma das 20 classes, armas nas mãos e 3 frames de caminhada.
 * - Construções em perspectiva 3/4 com fachada frontal, janelas iluminadas, portas de madeira, telhados inclinados
 *   e profundidade real (Y-sorting).
 */
export class AssetGenerator {
  public static generateAll(scene: Phaser.Scene) {
    if (scene.textures.exists('ground_meadow_25d')) return;

    this.createGroundTextures(scene);
    this.createNatureAndProps(scene);
    this.createVillageDetailProps(scene);
    this.createBakedFoliageChunks(scene);
    this.createArchitecture25D(scene);
    this.createAll20ClassCharacterFrames(scene);
    this.createWerewolf25DFrames(scene);
    this.createInteractiveProps(scene);
    this.createLightingMask(scene);
  }

  private static createCanvas(
    scene: Phaser.Scene,
    key: string,
    w: number,
    h: number,
    drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
  ) {
    const tex = scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, w, h);
    drawFn(ctx, w, h);
    tex.refresh();
  }

  private static createGroundTextures(scene: Phaser.Scene) {
    // 1. Gramado estilizado vibrante noturno (Tile 256x256)
    this.createCanvas(scene, 'ground_meadow_25d', 256, 256, (ctx, w, h) => {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#183024');
      bg.addColorStop(1, '#14281e');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Claras manchas de grama estilizada (Cel-shaded patches)
      const patches = [
        { x: 45, y: 60, rx: 38, ry: 22, c: '#1e3d2d' },
        { x: 180, y: 50, rx: 45, ry: 25, c: '#12231a' },
        { x: 110, y: 150, rx: 52, ry: 28, c: '#1e3d2d' },
        { x: 210, y: 200, rx: 36, ry: 20, c: '#1e3d2d' },
        { x: 50, y: 210, rx: 40, ry: 22, c: '#112118' }
      ];
      for (const p of patches) {
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Tufos de grama desenhados à mão e pequenas flores noturnas
      const blades = [
        { x: 30, y: 40 }, { x: 95, y: 80 }, { x: 160, y: 35 }, { x: 220, y: 95 },
        { x: 60, y: 140 }, { x: 140, y: 185 }, { x: 205, y: 155 }, { x: 85, y: 230 },
        { x: 180, y: 235 }, { x: 25, y: 190 }, { x: 125, y: 115 }, { x: 235, y: 45 }
      ];
      for (let i = 0; i < blades.length; i++) {
        const b = blades[i];
        ctx.strokeStyle = '#2d5a42';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.quadraticCurveTo(b.x - 5, b.y - 8, b.x - 8, b.y - 12);
        ctx.moveTo(b.x, b.y);
        ctx.quadraticCurveTo(b.x, b.y - 10, b.x + 1, b.y - 14);
        ctx.moveTo(b.x, b.y);
        ctx.quadraticCurveTo(b.x + 5, b.y - 8, b.x + 8, b.y - 11);
        ctx.stroke();

        // Pedrinhas decorativas ocasionais
        if (i % 3 === 0) {
          ctx.fillStyle = '#334155';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(b.x + 14, b.y + 4, 5, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
    });

    // 2. Calçada de Pedras Antigas Musgosas de Vila Medieval 2.5D (128x128)
    this.createCanvas(scene, 'ground_cobble_25d', 128, 128, (ctx, w, h) => {
      // Fundo de terra antiga e musgo entre as pedras
      ctx.fillStyle = '#1c1813';
      ctx.fillRect(0, 0, w, h);

      // Manchas de musgo verde-escuro nas frestas
      ctx.fillStyle = 'rgba(22, 50, 32, 0.55)';
      ctx.beginPath();
      ctx.arc(32, 40, 26, 0, Math.PI * 2);
      ctx.arc(96, 88, 30, 0, Math.PI * 2);
      ctx.fill();

      const stones = [
        { x: 6, y: 6, sw: 36, sh: 26, c: '#4a4238' },
        { x: 46, y: 6, sw: 42, sh: 26, c: '#3d352e' },
        { x: 92, y: 6, sw: 30, sh: 26, c: '#574c41' },
        { x: 14, y: 36, sw: 44, sh: 26, c: '#423a31' },
        { x: 62, y: 36, sw: 34, sh: 26, c: '#4a4238' },
        { x: 100, y: 36, sw: 24, sh: 26, c: '#362f28' },
        { x: 6, y: 66, sw: 32, sh: 26, c: '#574c41' },
        { x: 42, y: 66, sw: 46, sh: 26, c: '#4a4238' },
        { x: 92, y: 66, sw: 32, sh: 26, c: '#3d352e' },
        { x: 10, y: 96, sw: 40, sh: 26, c: '#3d352e' },
        { x: 54, y: 96, sw: 36, sh: 26, c: '#574c41' },
        { x: 94, y: 96, sw: 28, sh: 26, c: '#4a4238' }
      ];

      for (const s of stones) {
        ctx.fillStyle = '#0f0c0a';
        ctx.beginPath();
        ctx.roundRect(s.x, s.y + 3, s.sw, s.sh, 9);
        ctx.fill();

        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.roundRect(s.x, s.y, s.sw, s.sh - 2, 9);
        ctx.fill();
        ctx.strokeStyle = '#1c1612';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Reflexo âmbar quente das tochas nas pedras
        ctx.fillStyle = 'rgba(253, 224, 71, 0.08)';
        ctx.beginPath();
        ctx.roundRect(s.x + 4, s.y + 3, s.sw - 8, 5, 3);
        ctx.fill();
      }
    });

    // 3. Água cristalina estilizada com reflexos (128x128)
    this.createCanvas(scene, 'ground_water_25d', 128, 128, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#0369a1');
      grad.addColorStop(0.5, '#0284c7');
      grad.addColorStop(1, '#0369a1');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Faixas de espuma e brilho estilo cel-shaded
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.45)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let y = 16; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(16, y);
        ctx.quadraticCurveTo(44, y - 6, 72, y);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(82, y + 14);
        ctx.quadraticCurveTo(100, y + 8, 116, y + 14);
        ctx.stroke();
      }
    });
  }

  private static createNatureAndProps(scene: Phaser.Scene) {
    // 1. Árvore de Cedro 2.5D (Vista 3/4 com tronco de madeira, raízes e 3 copas volumosas - 104x128)
    this.createCanvas(scene, 'prop_cedar_25d', 104, 128, (ctx, w, h) => {
      const cx = w / 2;

      // Sombra projetada no chão
      ctx.fillStyle = 'rgba(4, 9, 14, 0.48)';
      ctx.beginPath();
      ctx.ellipse(cx, 114, 34, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // Tronco robusto com contorno preto
      ctx.fillStyle = '#5c2d0c';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 10, 78);
      ctx.lineTo(cx + 10, 78);
      ctx.lineTo(cx + 14, 114);
      ctx.lineTo(cx - 14, 114);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Veios da madeira no tronco
      ctx.fillStyle = '#78350f';
      ctx.fillRect(cx - 5, 84, 4, 26);

      // 3 Camadas de copa de pinheiro (de baixo para cima) com sombreamento e contorno cartoon
      const tiers = [
        { yBottom: 92, yTop: 46, halfW: 44, dark: '#064e3b', mid: '#059669', light: '#34d399' },
        { yBottom: 68, yTop: 26, halfW: 35, dark: '#065f46', mid: '#10b981', light: '#6ee7b7' },
        { yBottom: 44, yTop: 8, halfW: 25, dark: '#047857', mid: '#34d399', light: '#a7f3d0' }
      ];

      for (const t of tiers) {
        ctx.fillStyle = t.mid;
        ctx.strokeStyle = '#09131c';
        ctx.lineWidth = 3.2;

        ctx.beginPath();
        ctx.moveTo(cx, t.yTop);
        ctx.quadraticCurveTo(cx + t.halfW * 0.6, (t.yTop + t.yBottom) / 2, cx + t.halfW, t.yBottom);
        ctx.quadraticCurveTo(cx, t.yBottom + 9, cx - t.halfW, t.yBottom);
        ctx.quadraticCurveTo(cx - t.halfW * 0.6, (t.yTop + t.yBottom) / 2, cx, t.yTop);
        ctx.closePath();
        ctx.fill();

        // Sombra na base da copa
        ctx.fillStyle = t.dark;
        ctx.beginPath();
        ctx.arc(cx, t.yBottom - 4, t.halfW * 0.78, 0.1, Math.PI - 0.1);
        ctx.fill();

        // Brilho no topo esquerdo
        ctx.fillStyle = t.light;
        ctx.beginPath();
        ctx.ellipse(cx - t.halfW * 0.25, t.yTop + 14, t.halfW * 0.22, 6, -0.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.stroke();
      }
    });

    // 2. Touceira de Milharal Alto e Denso 2.5D (76x112 - Muito mais alta que os personagens para cobri-los totalmente!)
    this.createCanvas(scene, 'prop_corn_25d', 76, 112, (ctx, w, h) => {
      const cx = w / 2;

      // Sombra densa na base escondendo o chão
      ctx.fillStyle = 'rgba(8, 14, 6, 0.72)';
      ctx.beginPath();
      ctx.ellipse(cx, 100, 32, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // 3 Caules altos agrupados por touceira para fechar qualquer brecha
      const stalks = [
        { ox: -14, topY: 16, h: 84, c: '#365314' },
        { ox: 14, topY: 18, h: 82, c: '#3f6212' },
        { ox: 0, topY: 8, h: 94, c: '#4d7c0f' }
      ];

      for (const st of stalks) {
        const sx = cx + st.ox;

        // Caule alto robusto
        ctx.fillStyle = st.c;
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(sx - 4.5, st.topY, 9, st.h, 4);
        ctx.fill();
        ctx.stroke();

        // Folhas longas e largas cruzadas em várias alturas (cobrindo corpo e cabeça)
        const leafHeights = [st.topY + 62, st.topY + 44, st.topY + 26, st.topY + 12];
        leafHeights.forEach((ly, idx) => {
          const dir = idx % 2 === 0 ? -1 : 1;
          const span = 22 + (idx % 2) * 5;
          ctx.fillStyle = idx % 2 === 0 ? '#65a30d' : '#4d7c0f';
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(sx, ly);
          ctx.quadraticCurveTo(sx + dir * span * 0.65, ly - 15, sx + dir * span, ly + 4);
          ctx.quadraticCurveTo(sx + dir * span * 0.45, ly + 7, sx, ly + 8);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });

        // Pendão / Flor do topo do milharal alto
        ctx.strokeStyle = '#eab308';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(sx, st.topY + 2);
        ctx.lineTo(sx, st.topY - 7);
        ctx.moveTo(sx, st.topY);
        ctx.lineTo(sx - 6, st.topY - 5);
        ctx.moveTo(sx, st.topY);
        ctx.lineTo(sx + 6, st.topY - 5);
        ctx.stroke();
      }

      // Espigas de milho douradas grandes no meio da folhagem densa
      const cobs = [
        { x: cx - 16, y: 52, rot: -0.35 },
        { x: cx + 15, y: 44, rot: 0.35 },
        { x: cx - 3, y: 34, rot: 0.2 }
      ];
      for (const cob of cobs) {
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cob.x, cob.y, 5.5, 12, cob.rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });

    // 3. Lápide 2.5D Estilizada com Flores e Vela (48x58)
    this.createCanvas(scene, 'prop_gravestone_25d', 48, 58, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, 50, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Base de pedra
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(8, 42, 32, 9, 3);
      ctx.fill();
      ctx.stroke();

      // Corpo da lápide 3/4
      const grad = ctx.createLinearGradient(12, 10, 36, 44);
      grad.addColorStop(0, '#94a3b8');
      grad.addColorStop(1, '#64748b');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, 22, 13, Math.PI, 0);
      ctx.lineTo(cx + 13, 43);
      ctx.lineTo(cx - 13, 43);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Cruz celta esculpida
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, 15);
      ctx.lineTo(cx, 33);
      ctx.moveTo(cx - 6, 21);
      ctx.lineTo(cx + 6, 21);
      ctx.stroke();
    });

    // 4. Tocha Medieval Rústica em Estaca de Madeira e Gaiola de Ferro com Fogo Vivo (56x88)
    this.createCanvas(scene, 'prop_lamp_25d', 56, 88, (ctx, w, h) => {
      const cx = w / 2;

      // Halo de fogo alaranjado/âmbar quente
      const glow = ctx.createRadialGradient(cx, 22, 2, cx, 22, 27);
      glow.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
      glow.addColorStop(0.45, 'rgba(249, 115, 22, 0.55)');
      glow.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, 22, 27, 0, Math.PI * 2);
      ctx.fill();

      // Sombra e pedras de apoio na base da estaca
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, 80, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Estaca de madeira antiga entalhada
      ctx.fillStyle = '#5c2d0c';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(cx - 4, 32);
      ctx.lineTo(cx + 4, 32);
      ctx.lineTo(cx + 5, 80);
      ctx.lineTo(cx - 5, 80);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Amarras de corda sob o cesto da tocha
      ctx.fillStyle = '#a16207';
      ctx.fillRect(cx - 5, 34, 10, 5);
      ctx.strokeRect(cx - 5, 34, 10, 5);

      // Gaiola/Cesto de ferro forjado para a brasa
      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.moveTo(cx - 10, 22);
      ctx.lineTo(cx + 10, 22);
      ctx.lineTo(cx + 6, 34);
      ctx.lineTo(cx - 6, 34);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Labareda de fogo externa (Laranja/Vermelho)
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(cx - 8, 23);
      ctx.quadraticCurveTo(cx - 10, 10, cx, 3);
      ctx.quadraticCurveTo(cx + 10, 10, cx + 8, 23);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Núcleo da chama (Amarelo brilhante)
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(cx - 4, 22);
      ctx.quadraticCurveTo(cx - 5, 13, cx, 8);
      ctx.quadraticCurveTo(cx + 5, 13, cx + 4, 22);
      ctx.closePath();
      ctx.fill();

      // Fagulhas subindo
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(cx - 6, 7, 1.5, 0, Math.PI * 2);
      ctx.arc(cx + 7, 11, 1.3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  /**
   * Props ricos de ambientação e divisórias de zonas (Barris, Feno, Ovelha, Espantalho,
   * Arbustos Floridos, Suporte de Armas, Pilares de Pedra e Placas de Madeira 2.5D).
   */
  private static createVillageDetailProps(scene: Phaser.Scene) {
    // 1. Barril de Carvalho com Aros de Ferro 2.5D (40x48)
    this.createCanvas(scene, 'prop_barrel_25d', 40, 48, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, 41, 15, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#78350f';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(8, 10, 24, 30, 7);
      ctx.fill();
      ctx.stroke();

      // Aros metálicos
      ctx.fillStyle = '#475569';
      ctx.fillRect(8, 16, 24, 4);
      ctx.fillRect(8, 29, 24, 4);

      // Topo do barril
      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.ellipse(cx, 12, 11, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // 1b. Barril Grande de Esconderijo Interativo 2.5D (56x66 - Normal e Espiando por dentro)
    const drawHidingBarrel = (ctx: CanvasRenderingContext2D, isPeeking: boolean) => {
      const cx = 28;
      // Sombra no chão
      ctx.fillStyle = 'rgba(0,0,0,0.52)';
      ctx.beginPath();
      ctx.ellipse(cx, 57, 22, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Corpo robusto do barril de carvalho
      const woodGrad = ctx.createLinearGradient(10, 14, 46, 56);
      woodGrad.addColorStop(0, '#92400e');
      woodGrad.addColorStop(0.5, '#78350f');
      woodGrad.addColorStop(1, '#451a03');
      ctx.fillStyle = woodGrad;
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.roundRect(10, 14, 36, 42, 11);
      ctx.fill();
      ctx.stroke();

      // Divisórias verticais das aduelas de madeira
      ctx.strokeStyle = 'rgba(9, 13, 22, 0.45)';
      ctx.lineWidth = 1.5;
      [20, 28, 36].forEach((vx) => {
        ctx.beginPath();
        ctx.moveTo(vx, 18);
        ctx.lineTo(vx, 54);
        ctx.stroke();
      });

      // Aros de ferro forjado com rebites
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2;
      [23, 41].forEach((hy) => {
        ctx.fillRect(10, hy, 36, 5.5);
        ctx.strokeRect(10, hy, 36, 5.5);
      });

      if (isPeeking) {
        // Fresta escura sob a tampa com 2 olhinhos brilhantes espiando lá de dentro!
        ctx.fillStyle = '#05070b';
        ctx.beginPath();
        ctx.roundRect(14, 15, 28, 9, 4);
        ctx.fill();

        // Dois olhinhos amarelos/brancos atentos na fresta
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(cx - 5, 19.5, 2.2, 0, Math.PI * 2);
        ctx.arc(cx + 5, 19.5, 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Tampa levemente erguida sobre a cabeça
        ctx.fillStyle = '#b45309';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(cx, 12, 17, 6.5, -0.06, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        // Interior escuro entreaberto convidando a entrar
        ctx.fillStyle = '#090d16';
        ctx.beginPath();
        ctx.ellipse(cx, 16, 15, 6, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tampa de madeira semi-inclinada
        ctx.fillStyle = '#b45309';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(cx + 3, 14, 15, 5.5, 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    };

    this.createCanvas(scene, 'prop_hiding_barrel_25d', 56, 66, (ctx) => {
      drawHidingBarrel(ctx, false);
    });
    this.createCanvas(scene, 'prop_hiding_barrel_peek_25d', 56, 66, (ctx) => {
      drawHidingBarrel(ctx, true);
    });

    // 1c. Tumba Gótica / Sarcófago de Pedra do Cemitério 2.5D (96x74 - Exclusivo para o Lobisomem se esconder!)
    const drawWerewolfTomb = (ctx: CanvasRenderingContext2D, isWolfInsidePeeking: boolean) => {
      const cx = 48;
      // Sombra pesada no solo do cemitério
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      ctx.beginPath();
      ctx.ellipse(cx, 62, 42, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // Base de pedra talhada do sarcófago
      ctx.fillStyle = '#27303f';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(10, 32, 76, 30, 6);
      ctx.fill();
      ctx.stroke();

      // Arcos góticos esculpidos na lateral da tumba
      ctx.fillStyle = '#1b222d';
      [22, 44, 66].forEach((ax) => {
        ctx.fillRect(ax - 5, 38, 10, 18);
      });

      if (isWolfInsidePeeking) {
        // Interior escuro da tumba aberta com os olhos vermelhos brilhantes do Lobisomem espiando!
        ctx.fillStyle = '#040508';
        ctx.beginPath();
        ctx.roundRect(14, 24, 68, 18, 4);
        ctx.fill();

        // Dois olhos vermelhos ferozes brilhando na fresta da tumba
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.moveTo(cx - 11, 31);
        ctx.lineTo(cx - 4, 33);
        ctx.lineTo(cx - 8, 36);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(cx + 11, 31);
        ctx.lineTo(cx + 4, 33);
        ctx.lineTo(cx + 8, 36);
        ctx.closePath();
        ctx.fill();

        // Tampa de pedra pesada deslocada em diagonal
        ctx.save();
        ctx.translate(cx + 8, 22);
        ctx.rotate(0.14);
        ctx.fillStyle = '#475569';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(-36, -10, 72, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        // Tampa de pedra fechada com fresta sombria e cruz gótica esculpida
        ctx.fillStyle = '#090d16';
        ctx.fillRect(14, 29, 68, 5);

        const lidGrad = ctx.createLinearGradient(12, 14, 84, 34);
        lidGrad.addColorStop(0, '#64748b');
        lidGrad.addColorStop(1, '#334155');
        ctx.fillStyle = lidGrad;
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(12, 14, 72, 21, 5);
        ctx.fill();
        ctx.stroke();

        // Cruz horizontal entalhada no topo da tampa do sarcófago
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(26, 24);
        ctx.lineTo(70, 24);
        ctx.moveTo(40, 18);
        ctx.lineTo(40, 30);
        ctx.stroke();
      }
    };

    this.createCanvas(scene, 'prop_wolf_tomb_25d', 96, 74, (ctx) => {
      drawWerewolfTomb(ctx, false);
    });
    this.createCanvas(scene, 'prop_wolf_tomb_peek_25d', 96, 74, (ctx) => {
      drawWerewolfTomb(ctx, true);
    });

    // 1d. Barricada Pesada de Madeira e Toras Cruzadas 2.5D (Horizontal 180x84 e Vertical 92x180)
    // Colocada pelo Lobisomem nas estradas para bloquear a passagem entre os territórios!
    this.createCanvas(scene, 'prop_barricade_h_25d', 180, 84, (ctx, w, h) => {
      // Sombra no chão
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.ellipse(w / 2, h - 12, 82, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      // Estacas verticais cravadas na estrada
      ctx.fillStyle = '#451a03';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 3;
      [28, 68, 112, 152].forEach((px) => {
        ctx.beginPath();
        ctx.roundRect(px - 6, 14, 12, 58, 3);
        ctx.fill();
        ctx.stroke();
      });

      // Pranchas grossas horizontais pregadas bloqueando a estrada
      const planks = [
        { y: 22, rot: -0.03, c: '#78350f' },
        { y: 40, rot: 0.04, c: '#92400e' },
        { y: 56, rot: -0.02, c: '#5c2d0c' }
      ];
      for (const pl of planks) {
        ctx.save();
        ctx.translate(w / 2, pl.y);
        ctx.rotate(pl.rot);
        ctx.fillStyle = pl.c;
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.roundRect(-78, -7, 156, 14, 4);
        ctx.fill();
        ctx.stroke();

        // Pregos de ferro nas extremidades
        ctx.fillStyle = '#94a3b8';
        [-62, -22, 22, 62].forEach((nx) => {
          ctx.beginPath();
          ctx.arc(nx, 0, 2.3, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.restore();
      }
    });

    this.createCanvas(scene, 'prop_barricade_v_25d', 92, 180, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 + 8, 22, 82, 0, 0, Math.PI * 2);
      ctx.fill();

      // Toras e pranchas empilhadas verticalmente fechando a estrada horizontal
      for (let py = 20; py <= 152; py += 22) {
        ctx.fillStyle = py % 44 === 0 ? '#78350f' : '#92400e';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.roundRect(16, py, 60, 18, 5);
        ctx.fill();
        ctx.stroke();

        // Vigas laterais de travamento
        ctx.fillStyle = '#451a03';
        ctx.fillRect(22, py - 4, 8, 24);
        ctx.fillRect(62, py - 4, 8, 24);
      }
    });

    // 2. Fardo de Feno Dourado 2.5D (48x42)
    this.createCanvas(scene, 'prop_haybale_25d', 48, 42, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(24, 35, 20, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#eab308';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(6, 12, 36, 22, 6);
      ctx.fill();
      ctx.stroke();

      // Amarras do feno
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(16, 12);
      ctx.lineTo(16, 34);
      ctx.moveTo(32, 12);
      ctx.lineTo(32, 34);
      ctx.stroke();
    });

    // 3. Ovelha Fofa 2.5D para os Campos de Pastagem (46x42)
    this.createCanvas(scene, 'prop_sheep_25d', 46, 42, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(cx, 35, 16, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Patinhas pretas
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cx - 10, 28, 4, 7);
      ctx.fillRect(cx + 6, 28, 4, 7);

      // Lã branca volumosa
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(cx - 2, 22, 14, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Cabecinha escura
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(cx + 11, 20, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Olhinho brilhante
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + 13, 19, 1.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // 4. Espantalho Gótico do Milharal 2.5D (64x82)
    this.createCanvas(scene, 'prop_scarecrow_25d', 64, 82, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, 74, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Estaca de madeira cruzada
      ctx.fillStyle = '#5c2d0c';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.fillRect(cx - 3, 24, 6, 50);
      ctx.strokeRect(cx - 3, 24, 6, 50);
      ctx.fillRect(10, 34, 44, 6);
      ctx.strokeRect(10, 34, 44, 6);

      // Casaco rasgado
      ctx.fillStyle = '#9a3412';
      ctx.beginPath();
      ctx.roundRect(cx - 12, 32, 24, 24, 5);
      ctx.fill();
      ctx.stroke();

      // Cabeça de saco de estopa
      ctx.fillStyle = '#d97706';
      ctx.beginPath();
      ctx.arc(cx, 23, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Chapéu de bruxo/espantalho
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(cx - 18, 17);
      ctx.lineTo(cx, 2);
      ctx.lineTo(cx + 18, 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // 5. Arbusto Florido Noturno 2.5D para divisórias vivas (52x46)
    this.createCanvas(scene, 'prop_bush_25d', 52, 46, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath();
      ctx.ellipse(cx, 38, 21, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#065f46';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx - 10, 26, 12, 0, Math.PI * 2);
      ctx.arc(cx + 10, 26, 12, 0, Math.PI * 2);
      ctx.arc(cx, 19, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Brilho de folhagem e pequenas flores
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(cx - 3, 15, 7, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(cx - 9, 24, 2.2, 0, Math.PI * 2);
      ctx.arc(cx + 7, 21, 2.2, 0, Math.PI * 2);
      ctx.arc(cx + 1, 28, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // 6. Suporte de Armas & Bigorna da Ferraria 2.5D (64x56)
    this.createCanvas(scene, 'prop_weapon_rack_25d', 64, 56, (ctx, w, h) => {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(32, 48, 26, 7, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cavalete de madeira
      ctx.fillStyle = '#5c2d0c';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.fillRect(10, 14, 6, 34);
      ctx.strokeRect(10, 14, 6, 34);
      ctx.fillRect(48, 14, 6, 34);
      ctx.strokeRect(48, 14, 6, 34);
      ctx.fillRect(8, 22, 48, 6);
      ctx.strokeRect(8, 22, 48, 6);

      // Espadas de prata apoiadas
      ctx.fillStyle = '#e2e8f0';
      [22, 32, 42].forEach((sx) => {
        ctx.fillRect(sx - 2, 10, 4, 32);
        ctx.strokeRect(sx - 2, 10, 4, 32);
        ctx.fillStyle = '#eab308';
        ctx.fillRect(sx - 5, 16, 10, 3);
        ctx.fillStyle = '#e2e8f0';
      });
    });

    // 7. Braseiro Medieval de Pedra & Ferro com Fogo Vivo para Portões (44x68)
    this.createCanvas(scene, 'prop_stone_pillar_25d', 44, 68, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(cx, 58, 17, 6.5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Halo de fogo do braseiro
      const fireAura = ctx.createRadialGradient(cx, 18, 2, cx, 18, 21);
      fireAura.addColorStop(0, 'rgba(254, 240, 138, 0.9)');
      fireAura.addColorStop(0.5, 'rgba(249, 115, 22, 0.5)');
      fireAura.addColorStop(1, 'rgba(234, 88, 12, 0)');
      ctx.fillStyle = fireAura;
      ctx.beginPath();
      ctx.arc(cx, 18, 21, 0, Math.PI * 2);
      ctx.fill();

      // Pedestal rústico de pedra antiga
      ctx.fillStyle = '#4a4238';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(cx - 10, 32, 20, 26, 4);
      ctx.fill();
      ctx.stroke();

      // Bacia de ferro forjado do braseiro
      ctx.fillStyle = '#27272a';
      ctx.beginPath();
      ctx.arc(cx, 26, 13, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Chamas vivas triplas no braseiro
      ctx.fillStyle = '#f97316';
      ctx.beginPath();
      ctx.moveTo(cx - 10, 26);
      ctx.quadraticCurveTo(cx - 11, 12, cx - 5, 9);
      ctx.quadraticCurveTo(cx, 2, cx, 2);
      ctx.quadraticCurveTo(cx + 5, 9, cx + 10, 26);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(cx - 5, 25);
      ctx.quadraticCurveTo(cx, 8, cx + 5, 25);
      ctx.closePath();
      ctx.fill();
    });

    // 8. Fogueira Antiga de Vilarejo com Troncos e Anel de Pedras 2.5D (68x64)
    this.createCanvas(scene, 'prop_campfire_25d', 68, 64, (ctx, w, h) => {
      const cx = w / 2;
      const cy = 42;

      // Brilho quente no chão ao redor da fogueira
      const groundGlow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 32);
      groundGlow.addColorStop(0, 'rgba(249, 115, 22, 0.75)');
      groundGlow.addColorStop(0.6, 'rgba(234, 88, 12, 0.25)');
      groundGlow.addColorStop(1, 'rgba(234, 88, 12, 0)');
      ctx.fillStyle = groundGlow;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 32, 20, 0, 0, Math.PI * 2);
      ctx.fill();

      // Anel de pedras ao redor da fogueira
      ctx.fillStyle = '#574c41';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 18, cy + Math.sin(a) * 9, 6, 4.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Troncos de lenha cruzados
      ctx.fillStyle = '#5c2d0c';
      ctx.beginPath();
      ctx.roundRect(cx - 15, cy - 4, 30, 7, 3);
      ctx.fill();
      ctx.stroke();

      // Labaredas altas da fogueira
      ctx.fillStyle = '#f97316';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 12, cy);
      ctx.quadraticCurveTo(cx - 14, 16, cx, 6);
      ctx.quadraticCurveTo(cx + 14, 16, cx + 12, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.quadraticCurveTo(cx, 14, cx + 6, cy);
      ctx.closePath();
      ctx.fill();
    });
  }

  /**
   * Pré-renderiza:
   * 1. A Grande Árvore Ancestral (400x400) que cobre e esconde quem entra sob sua copa gigante;
   * 2. O Milharal Alto e Denso (680x560);
   * 3. O Bosque de Caça do Sul (580x480);
   * 4. O Terreno Orgânico Completo da Vila Antiga (4200x2800) com Lago Raso, Trilhas Sinuosas,
   *    Rio Leste, Bosques Naturais e Clareiras Temáticas (NADA de salas quadradas de nave espacial!).
   */
  private static createBakedFoliageChunks(scene: Phaser.Scene) {
    const cornTex = scene.textures.get('prop_corn_25d').getSourceImage() as HTMLCanvasElement;
    const cedarTex = scene.textures.get('prop_cedar_25d').getSourceImage() as HTMLCanvasElement;
    const bushTex = scene.textures.get('prop_bush_25d').getSourceImage() as HTMLCanvasElement;
    const cobbleTex = scene.textures.get('ground_cobble_25d').getSourceImage() as HTMLCanvasElement;
    const meadowTex = scene.textures.get('ground_meadow_25d').getSourceImage() as HTMLCanvasElement;

    // 1. A GRANDE ÁRVORE ANCESTRAL (400x400) — Copa imensa no Santuário Norte que oculta quem entra embaixo!
    this.createCanvas(scene, 'prop_giant_ancient_tree_25d', 400, 400, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;

      // Sombra gigante da copa no chão
      ctx.fillStyle = 'rgba(3, 8, 5, 0.62)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 48, 178, 125, 0, 0, Math.PI * 2);
      ctx.fill();

      // Raízes e Tronco Milenar Retorcido
      ctx.fillStyle = '#4a250a';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy - 10);
      ctx.quadraticCurveTo(cx - 42, cy + 75, cx - 85, cy + 125);
      ctx.lineTo(cx - 35, cy + 118);
      ctx.lineTo(cx, cy + 135);
      ctx.lineTo(cx + 35, cy + 118);
      ctx.lineTo(cx + 85, cy + 125);
      ctx.quadraticCurveTo(cx + 42, cy + 75, cx + 32, cy - 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Veios antigos na casca do tronco
      ctx.strokeStyle = '#271203';
      ctx.lineWidth = 3;
      for (let ox = -18; ox <= 18; ox += 12) {
        ctx.beginPath();
        ctx.moveTo(cx + ox, cy);
        ctx.quadraticCurveTo(cx + ox * 1.4, cy + 60, cx + ox * 1.8, cy + 110);
        ctx.stroke();
      }

      // Copa Gigante Multicamadas (folhagem densa que esconde jogadores embaixo)
      const foliageBlobs = [
        { x: cx - 85, y: cy + 5, r: 82, c: '#064e3b' },
        { x: cx + 85, y: cy + 5, r: 82, c: '#064e3b' },
        { x: cx - 65, y: cy - 60, r: 78, c: '#065f46' },
        { x: cx + 65, y: cy - 60, r: 78, c: '#065f46' },
        { x: cx, y: cy + 25, r: 95, c: '#064e3b' },
        { x: cx, y: cy - 45, r: 105, c: '#047857' },
        { x: cx - 35, y: cy - 20, r: 68, c: '#059669' },
        { x: cx + 35, y: cy - 25, r: 65, c: '#059669' },
        { x: cx, y: cy - 75, r: 62, c: '#10b981' }
      ];
      for (const fb of foliageBlobs) {
        ctx.fillStyle = fb.c;
        ctx.strokeStyle = '#04120c';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(fb.x, fb.y, fb.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Vaga-lumes / frutos dourados mágicos brilhando na copa da Árvore Ancestral
      ctx.fillStyle = '#fef08a';
      const lights = [
        { x: cx - 90, y: cy - 10 },
        { x: cx + 85, y: cy - 15 },
        { x: cx - 40, y: cy - 85 },
        { x: cx + 48, y: cy - 75 },
        { x: cx, y: cy - 25 },
        { x: cx - 55, y: cy + 35 },
        { x: cx + 62, y: cy + 30 }
      ];
      for (const l of lights) {
        ctx.beginPath();
        ctx.arc(l.x, l.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 2. Chunk do Milharal Alto e Denso (340x280 escalado 2x = 680x560)
    this.createCanvas(scene, 'chunk_cornfield_25d', 340, 280, (ctx) => {
      ctx.save();
      ctx.scale(0.5, 0.5);
      for (let cy = 32; cy <= 528; cy += 34) {
        for (let cx = 32; cx <= 648; cx += 36) {
          const jx = ((cx * 7 + cy * 13) % 14) - 7;
          const jy = ((cx * 11 + cy * 5) % 12) - 6;
          ctx.drawImage(cornTex, cx + jx - 38, cy + jy - 96, 82, 118);
        }
      }
      ctx.restore();
    });

    // 3. Chunk do Bosque de Caça do Sul (300x240 escalado 2x = 600x480)
    this.createCanvas(scene, 'chunk_cedar_forest_25d', 300, 240, (ctx) => {
      ctx.save();
      ctx.scale(0.5, 0.5);
      for (let py = 45; py <= 435; py += 58) {
        for (let px = 45; px <= 555; px += 52) {
          const jx = ((px * 13 + py * 29) % 22) - 11;
          const jy = ((px * 19 + py * 17) % 16) - 8;
          ctx.drawImage(cedarTex, px + jx - 54, py + jy - 104, 108, 132);
        }
      }
      ctx.restore();
    });

    // 4. TERRENO ORGÂNICO COMPLETO DA VILA ANTIGA (2100x1400 escalado 2x = 4200x2800):
    // ZERO bordas duras ou linhas geométricas dividindo o chão! Todas as regiões e estradas
    // usam fusão gradual (RadialGradients com alpha 0 nas bordas), pedras soltas, musgo e vegetação harmônica!
    this.createCanvas(scene, 'baked_skeld_village_layout', 2100, 1400, (ctx) => {
      ctx.save();
      ctx.scale(0.5, 0.5);

      // A) Gramado Florestal Base contínuo em todo o mundo (4200x2800)
      const meadowPattern = ctx.createPattern(meadowTex, 'repeat');
      ctx.fillStyle = meadowPattern || '#14261c';
      ctx.fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

      // Helper para fusão gradual e suave de solo no terreno (SEM linhas de borda duras!)
      const blendSoftTerrain = (
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        innerColor: string,
        midColor: string
      ) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, ry / rx);
        const grad = ctx.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
        grad.addColorStop(0, innerColor);
        grad.addColorStop(0.58, midColor);
        grad.addColorStop(0.85, 'rgba(20, 38, 28, 0.25)');
        grad.addColorStop(1, 'rgba(20, 38, 28, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };

      // Helper para espalhar pedras de calçamento antigas e musgo que somem gradualmente nas bordas
      const scatterSteppingStones = (
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        stoneColor = '#4a4238',
        density = 42
      ) => {
        for (let i = 0; i < density; i++) {
          const angle = (i * 137.5 * Math.PI) / 180;
          const distFactor = Math.sqrt((i + 0.5) / density) * 0.88;
          const sx = cx + Math.cos(angle) * rx * distFactor;
          const sy = cy + Math.sin(angle) * ry * distFactor;
          const size = (1 - distFactor * 0.45) * 18;

          ctx.fillStyle = 'rgba(10, 14, 11, 0.45)';
          ctx.beginPath();
          ctx.ellipse(sx, sy + 2, size, size * 0.65, (i % 5) * 0.2, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = stoneColor;
          ctx.beginPath();
          ctx.ellipse(sx, sy, size * 0.9, size * 0.58, (i % 5) * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      };

      // B) Fusão Gradual de Solo de Cada Território (Transição 100% Harmônica com a Floresta!)
      // 1. Praça Central da Catedral (Terra antiga + pedras que se fundem na grama)
      blendSoftTerrain(
        CHURCH_CENTER.x,
        CHURCH_CENTER.y,
        520,
        420,
        'rgba(48, 39, 31, 0.92)',
        'rgba(36, 29, 23, 0.65)'
      );
      scatterSteppingStones(CHURCH_CENTER.x, CHURCH_CENTER.y, 440, 340, '#52473c', 75);

      // 2. Prado das Ovelhas (Clareira de grama esmeralda luminosa e flores)
      blendSoftTerrain(
        1400,
        640,
        360,
        310,
        'rgba(34, 78, 52, 0.85)',
        'rgba(25, 58, 39, 0.45)'
      );

      // 3. Santuário da Grande Árvore Ancestral (Musgo místico verde-azulado suave)
      blendSoftTerrain(
        GIANT_ANCIENT_TREE.x,
        GIANT_ANCIENT_TREE.y,
        370,
        290,
        'rgba(16, 62, 43, 0.88)',
        'rgba(12, 45, 32, 0.45)'
      );

      // 4. Solar da Prefeitura (Solo ocre suave com lajotas esparsas)
      blendSoftTerrain(
        2850,
        640,
        380,
        310,
        'rgba(46, 36, 29, 0.86)',
        'rgba(33, 26, 21, 0.48)'
      );
      scatterSteppingStones(2850, 640, 310, 240, '#4f443a', 45);

      // 5. Cemitério das Brumas (Terra úmida sombria e bruma azulada gradual, sem borda quadrada!)
      blendSoftTerrain(
        2990,
        1330,
        390,
        340,
        'rgba(22, 30, 40, 0.88)',
        'rgba(17, 24, 32, 0.48)'
      );
      scatterSteppingStones(2990, 1330, 320, 260, '#3b4452', 40);

      // 6. Vila das Cabanas & Barris (Terreiro rústico aquecido pela fogueira, transição gradual!)
      blendSoftTerrain(
        680,
        1400,
        420,
        350,
        'rgba(52, 36, 23, 0.88)',
        'rgba(38, 26, 17, 0.48)'
      );
      scatterSteppingStones(680, 1400, 330, 260, '#543d2b', 38);

      // 7. Fazenda do Milharal Alto (Húmus fértil escuro que se dissolve na grama ao redor)
      blendSoftTerrain(
        700,
        2190,
        440,
        380,
        'rgba(38, 25, 14, 0.9)',
        'rgba(28, 19, 11, 0.5)'
      );

      // 8. Bosque de Caça do Sul (Sub-bosque profundo)
      blendSoftTerrain(
        1560,
        2220,
        390,
        330,
        'rgba(11, 29, 20, 0.88)',
        'rgba(11, 29, 20, 0.45)'
      );

      // 9. Círculo de Menires Rúnicos (Brilho arcano índigo difuso no chão, sem linha dura!)
      blendSoftTerrain(
        2360,
        2210,
        340,
        310,
        'rgba(49, 46, 129, 0.78)',
        'rgba(30, 27, 75, 0.38)'
      );
      // Anéis rúnicos sutis e translúcidos gravados na terra
      ctx.strokeStyle = 'rgba(165, 180, 252, 0.28)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(2360, 2210, 165, 0, Math.PI * 2);
      ctx.arc(2360, 2210, 95, 0, Math.PI * 2);
      ctx.stroke();

      // 10. Forja Vulcânica da Ferraria (Terra aquecida por brasas e pedras de ardósia suaves)
      blendSoftTerrain(
        3130,
        2170,
        380,
        360,
        'rgba(54, 28, 18, 0.88)',
        'rgba(36, 20, 14, 0.48)'
      );
      scatterSteppingStones(3130, 2170, 300, 280, '#47362e', 48);

      // C) Trilhas e Estradas Orgânicas com Bordas Difusas e Pedras de Calçamento (Sem linha preta dura!)
      const drawHarmonicTrail = (
        points: { x: number; y: number }[],
        radius: number,
        withStones = false
      ) => {
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
          const steps = Math.max(2, Math.ceil(dist / 36));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const px = p1.x + (p2.x - p1.x) * t;
            const py = p1.y + (p2.y - p1.y) * t;

            // Mancha radial suave de terra batida que se mistura com a grama
            const g = ctx.createRadialGradient(px, py, radius * 0.15, px, py, radius);
            g.addColorStop(0, 'rgba(62, 44, 28, 0.52)');
            g.addColorStop(0.6, 'rgba(48, 34, 22, 0.26)');
            g.addColorStop(1, 'rgba(48, 34, 22, 0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, radius, 0, Math.PI * 2);
            ctx.fill();

            // Pedrinhas naturais espaçadas ao longo da trilha
            if (withStones && s % 2 === 0) {
              const ox = ((s * 17 + i * 31) % 26) - 13;
              const oy = ((s * 23 + i * 19) % 22) - 11;
              ctx.fillStyle = 'rgba(82, 71, 60, 0.55)';
              ctx.beginPath();
              ctx.ellipse(px + ox, py + oy, 13, 8.5, (s % 4) * 0.3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      };

      // Caminhos harmônicos e suaves conectando os territórios (incluindo trilhas dos Totens Rúnicos)
      for (let idx = 0; idx < VILLAGE_TRAIL_POLYLINE_LIST.length; idx++) {
        const poly = VILLAGE_TRAIL_POLYLINE_LIST[idx];
        drawHarmonicTrail(poly.points, poly.radius + 18, idx < 2);
      }

      // D) Lago Raso do Poço Antigo com Margem Gradual e Suave (Sem linha dura na beira d'água!)
      ctx.save();
      ctx.translate(SHALLOW_LAKE_ZONE.centerX, SHALLOW_LAKE_ZONE.centerY);
      ctx.scale(1, SHALLOW_LAKE_ZONE.ry / SHALLOW_LAKE_ZONE.rx);

      // Transição de areia úmida e musgo na beira do lago
      const shoreGrad = ctx.createRadialGradient(
        0,
        0,
        SHALLOW_LAKE_ZONE.rx * 0.5,
        0,
        0,
        SHALLOW_LAKE_ZONE.rx + 45
      );
      shoreGrad.addColorStop(0, 'rgba(30, 48, 38, 0.85)');
      shoreGrad.addColorStop(0.75, 'rgba(36, 42, 32, 0.45)');
      shoreGrad.addColorStop(1, 'rgba(20, 38, 28, 0)');
      ctx.fillStyle = shoreGrad;
      ctx.beginPath();
      ctx.arc(0, 0, SHALLOW_LAKE_ZONE.rx + 45, 0, Math.PI * 2);
      ctx.fill();

      // Água rasa com borda externa que desaparece suavemente na margem
      const lakeGrad = ctx.createRadialGradient(0, 0, 35, 0, 0, SHALLOW_LAKE_ZONE.rx);
      lakeGrad.addColorStop(0, 'rgba(14, 165, 233, 0.88)');
      lakeGrad.addColorStop(0.55, 'rgba(2, 132, 199, 0.78)');
      lakeGrad.addColorStop(0.86, 'rgba(12, 74, 110, 0.45)');
      lakeGrad.addColorStop(1, 'rgba(12, 74, 110, 0)');
      ctx.fillStyle = lakeGrad;
      ctx.beginPath();
      ctx.arc(0, 0, SHALLOW_LAKE_ZONE.rx, 0, Math.PI * 2);
      ctx.fill();

      // Ilhota central do Poço com transição suave de pedras e musgo
      const islandGrad = ctx.createRadialGradient(0, 0, 30, 0, 0, 92);
      islandGrad.addColorStop(0, '#475569');
      islandGrad.addColorStop(0.68, '#334155');
      islandGrad.addColorStop(1, 'rgba(51, 65, 85, 0)');
      ctx.fillStyle = islandGrad;
      ctx.beginPath();
      ctx.arc(0, 0, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Vitórias-régias (nenúfares) flutuando na água rasa
      ctx.fillStyle = 'rgba(21, 128, 61, 0.85)';
      [
        { x: 480, y: 590, r: 17 },
        { x: 840, y: 610, r: 20 },
        { x: 520, y: 780, r: 19 },
        { x: 820, y: 770, r: 16 },
        { x: 610, y: 530, r: 15 }
      ].forEach((lp) => {
        ctx.beginPath();
        ctx.arc(lp.x, lp.y, lp.r, 0.25, Math.PI * 1.88);
        ctx.lineTo(lp.x, lp.y);
        ctx.closePath();
        ctx.fill();
      });

      // E) O Rio Profundo a Leste com Margens Graduais de Terra, Musgo e Rochas (Sem linha reta dura!)
      const riverCenter = (RIVER_LEFT_BANK + RIVER_RIGHT_BANK) / 2;
      const riverHalfW = (RIVER_RIGHT_BANK - RIVER_LEFT_BANK) / 2;
      const riverBankGrad = ctx.createLinearGradient(
        riverCenter - riverHalfW - 45,
        0,
        riverCenter + riverHalfW + 45,
        0
      );
      riverBankGrad.addColorStop(0, 'rgba(20, 38, 28, 0)');
      riverBankGrad.addColorStop(0.18, 'rgba(28, 36, 29, 0.75)');
      riverBankGrad.addColorStop(0.28, 'rgba(7, 89, 133, 0.92)');
      riverBankGrad.addColorStop(0.5, 'rgba(2, 132, 199, 0.96)');
      riverBankGrad.addColorStop(0.72, 'rgba(7, 89, 133, 0.92)');
      riverBankGrad.addColorStop(0.82, 'rgba(28, 36, 29, 0.75)');
      riverBankGrad.addColorStop(1, 'rgba(20, 38, 28, 0)');
      ctx.fillStyle = riverBankGrad;
      ctx.fillRect(
        riverCenter - riverHalfW - 45,
        0,
        (riverHalfW + 45) * 2,
        MAP_HEIGHT
      );

      // Ondulações suaves na água do rio
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.26)';
      ctx.lineWidth = 2.5;
      for (let ry = 60; ry < MAP_HEIGHT; ry += 110) {
        ctx.beginPath();
        ctx.moveTo(RIVER_LEFT_BANK + 32, ry);
        ctx.quadraticCurveTo(riverCenter + 15, ry + 35, RIVER_LEFT_BANK + 48, ry + 70);
        ctx.stroke();
      }

      // F) Vegetação Natural (Árvores e Arbustos) preenchendo harmonicamente todas as áreas fora das trilhas e clareiras!
      // Assim o jogador vê claramente os caminhos abertos no meio da floresta e não pode cortar caminho pelo mato!
      for (let fy = 90; fy <= MAP_HEIGHT - 70; fy += 92) {
        for (let fx = 90; fx <= MAP_WIDTH - 70; fx += 92) {
          const jx = ((fx * 17 + fy * 13) % 38) - 19;
          const jy = ((fx * 11 + fy * 23) % 34) - 17;
          const px = fx + jx;
          const py = fy + jy;

          // Não planta árvores dentro do Rio nem sobre as Trilhas/Clareiras caminháveis (deixa margem de 42px)
          if (px > RIVER_LEFT_BANK - 50 && px < RIVER_RIGHT_BANK + 50) continue;
          if (
            isOnPathOrClearing(px, py) ||
            isOnPathOrClearing(px - 38, py) ||
            isOnPathOrClearing(px + 38, py) ||
            isOnPathOrClearing(px, py - 38) ||
            isOnPathOrClearing(px, py + 38)
          ) {
            continue;
          }

          // Sombra suave sob a mata fora da trilha
          const shade = ctx.createRadialGradient(px, py, 10, px, py, 75);
          shade.addColorStop(0, 'rgba(5, 14, 9, 0.55)');
          shade.addColorStop(1, 'rgba(5, 14, 9, 0)');
          ctx.fillStyle = shade;
          ctx.beginPath();
          ctx.arc(px, py, 75, 0, Math.PI * 2);
          ctx.fill();

          // Alterna harmoniosamente entre arbustos floridos nas bordas da trilha e cedros altos no fundo
          ctx.drawImage(bushTex, px - 36, py - 18, 54, 46);
          ctx.drawImage(cedarTex, px - 48, py - 88, 96, 118);
        }
      }

      // Moldura florestal nas 4 bordas do mundo
      for (let bx = 60; bx < MAP_WIDTH; bx += 95) {
        ctx.drawImage(cedarTex, bx - 52, -10, 104, 128);
        ctx.drawImage(cedarTex, bx - 52, MAP_HEIGHT - 115, 104, 128);
      }
      for (let by = 80; by < MAP_HEIGHT; by += 95) {
        ctx.drawImage(cedarTex, -15, by - 64, 104, 128);
        ctx.drawImage(cedarTex, MAP_WIDTH - 90, by - 64, 104, 128);
      }

      ctx.restore();
    });
  }

  private static createArchitecture25D(scene: Phaser.Scene) {
    // 1. Catedral Gótica 2.5D com Fachada, Rosácea, Vitrais Acesos e Pátio do Sino (380x340)
    this.createCanvas(scene, 'building_church_25d', 380, 340, (ctx, w, h) => {
      // Sombra projetada da Catedral
      ctx.fillStyle = 'rgba(5, 8, 15, 0.6)';
      ctx.beginPath();
      ctx.roundRect(18, 26, w - 24, h - 24, 16);
      ctx.fill();

      // Piso do Pátio Sagrado e Nave Aberta (para ver os jogadores dentro durante o Tribunal e a Fase 3)
      ctx.fillStyle = '#273244';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(14, 48, w - 28, h - 62, 12);
      ctx.fill();
      ctx.stroke();

      // Lajotas decorativas internas
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 1.5;
      for (let x = 42; x < w - 30; x += 34) {
        ctx.beginPath();
        ctx.moveTo(x, 54);
        ctx.lineTo(x, h - 18);
        ctx.stroke();
      }
      for (let y = 80; y < h - 20; y += 34) {
        ctx.beginPath();
        ctx.moveTo(20, y);
        ctx.lineTo(w - 20, y);
        ctx.stroke();
      }

      // Tapete Real Vermelho e Dourado levando ao Altar Central
      ctx.fillStyle = '#991b1b';
      ctx.fillRect(w / 2 - 34, 54, 68, h - 72);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(w / 2 - 30, 56, 60, h - 76);

      // Bancos de Madeira 2.5D com encosto e sombra
      for (let row = 0; row < 4; row++) {
        const py = 100 + row * 48;
        [36, w - 126].forEach((bx) => {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(bx, py + 14, 90, 6);

          ctx.fillStyle = '#78350f';
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(bx, py, 90, 16, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#92400e';
          ctx.fillRect(bx + 3, py + 2, 84, 5);
        });
      }

      // Fachada Superior Gótica 2.5D com Telhado Azul-Ardósia, Torres Laterais e Vitrais
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.roundRect(10, 10, w - 20, 54, 8);
      ctx.fill();
      ctx.stroke();

      // Vitrais Góticos Luminosos na parede norte
      const windowPositions = [52, 106, w - 126, w - 72];
      const windowColors = ['#38bdf8', '#f59e0b', '#f59e0b', '#38bdf8'];
      windowPositions.forEach((wx, idx) => {
        ctx.fillStyle = windowColors[idx];
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(wx + 10, 32, 10, Math.PI, 0);
        ctx.lineTo(wx + 20, 52);
        ctx.lineTo(wx, 52);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      });

      // Frontão Triangular Central com Rosácea Dourada
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 58, 64);
      ctx.lineTo(w / 2, 4);
      ctx.lineTo(w / 2 + 58, 64);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Rosácea de Vitral
      const roseGrad = ctx.createRadialGradient(w / 2, 38, 2, w / 2, 38, 16);
      roseGrad.addColorStop(0, '#fef08a');
      roseGrad.addColorStop(0.6, '#f97316');
      roseGrad.addColorStop(1, '#7c2d12');
      ctx.fillStyle = roseGrad;
      ctx.beginPath();
      ctx.arc(w / 2, 38, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });

    // 2. Campanário & Sino Sagrado de Bronze 2.5D (80x92)
    this.createCanvas(scene, 'prop_bell_25d', 80, 92, (ctx, w, h) => {
      const cx = w / 2;

      // Plataforma circular de mármore
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, 74, 34, 14, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, 70, 32, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Colunas de madeira que sustentam o Sino
      ctx.fillStyle = '#5c2d0c';
      ctx.beginPath();
      ctx.roundRect(cx - 24, 20, 8, 50, 3);
      ctx.roundRect(cx + 16, 20, 8, 50, 3);
      ctx.fill();
      ctx.stroke();

      // Sino de Ouro/Bronze em perspectiva frontal
      const bellGrad = ctx.createLinearGradient(cx - 16, 24, cx + 16, 60);
      bellGrad.addColorStop(0, '#fef08a');
      bellGrad.addColorStop(0.45, '#eab308');
      bellGrad.addColorStop(1, '#a16207');
      ctx.fillStyle = bellGrad;

      ctx.beginPath();
      ctx.arc(cx, 38, 13, Math.PI, 0);
      ctx.quadraticCurveTo(cx + 14, 52, cx + 19, 58);
      ctx.lineTo(cx - 19, 58);
      ctx.quadraticCurveTo(cx - 14, 52, cx - 13, 38);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Badalo do sino
      ctx.fillStyle = '#713f12';
      ctx.beginPath();
      ctx.arc(cx, 59, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Trave superior
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.roundRect(cx - 28, 14, 56, 10, 4);
      ctx.fill();
      ctx.stroke();
    });

    // 3. Cabana Rústica de Toras & Telhado de Palha 2.5D (Thatch & Log Cabin - 160x140)
    this.createCanvas(scene, 'building_cottage_25d', 160, 140, (ctx, w, h) => {
      // Sombra projetada no chão
      ctx.fillStyle = 'rgba(0, 0, 0, 0.52)';
      ctx.beginPath();
      ctx.ellipse(w / 2, h - 10, 72, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      // Fundação baixa de pedras arredondadas de rio
      const stoneXs = [24, 42, 60, 78, 96, 114, 130];
      for (const sx of stoneXs) {
        ctx.fillStyle = '#475569';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.roundRect(sx - 8, 114, 18, 11, 5);
        ctx.fill();
        ctx.stroke();
      }

      // Paredes de Toras de Madeira Empilhadas (Log Cabin Logs)
      const logCount = 5;
      for (let i = 0; i < logCount; i++) {
        const ly = 64 + i * 11;
        const logGrad = ctx.createLinearGradient(0, ly, 0, ly + 11);
        logGrad.addColorStop(0, '#854d0e');
        logGrad.addColorStop(0.5, '#713f12');
        logGrad.addColorStop(1, '#451a03');
        ctx.fillStyle = logGrad;
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.4;

        ctx.beginPath();
        ctx.roundRect(20, ly, w - 40, 11.5, 5);
        ctx.fill();
        ctx.stroke();

        // Encaixes circulares das pontas das toras nas quinas (Log Notches)
        [18, w - 18].forEach((nx) => {
          ctx.fillStyle = '#a16207';
          ctx.beginPath();
          ctx.arc(nx, ly + 5.5, 5.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          // Anel interno da tora cortada
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(nx, ly + 5.5, 2, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // Porta Rústica de Tábuas de Carvalho com Ferro Forjado no centro
      ctx.fillStyle = '#451a03';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(w / 2, 92, 14, Math.PI, 0);
      ctx.lineTo(w / 2 + 14, 123);
      ctx.lineTo(w / 2 - 14, 123);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Divisórias verticais das tábuas da porta e ferrolho
      ctx.strokeStyle = '#271203';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 5, 80);
      ctx.lineTo(w / 2 - 5, 122);
      ctx.moveTo(w / 2 + 5, 80);
      ctx.lineTo(w / 2 + 5, 122);
      ctx.stroke();

      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(w / 2 + 9, 104, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Janelinhas Rústicas de Cabana com Luz Quente de Lareira
      [34, w - 56].forEach((wx) => {
        ctx.fillStyle = '#fef08a';
        ctx.strokeStyle = '#090d16';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.roundRect(wx, 77, 22, 20, 4);
        ctx.fill();
        ctx.stroke();

        // Moldura cruzada de madeira
        ctx.strokeStyle = '#451a03';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wx + 11, 77);
        ctx.lineTo(wx + 11, 97);
        ctx.moveTo(wx, 87);
        ctx.lineTo(wx + 22, 87);
        ctx.stroke();
      });

      // Chaminé rústica de pedras empilhadas na direita
      ctx.fillStyle = '#64748b';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(w - 44, 12, 20, 40, 4);
      ctx.fill();
      ctx.stroke();

      // Telhado Volumoso de Palha / Colmo (Thatched Roof 2.5D)
      const thatchGrad = ctx.createLinearGradient(0, 12, 0, 74);
      thatchGrad.addColorStop(0, '#eab308');
      thatchGrad.addColorStop(0.55, '#ca8a04');
      thatchGrad.addColorStop(1, '#854d0e');
      ctx.fillStyle = thatchGrad;
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 3.2;

      ctx.beginPath();
      ctx.moveTo(w / 2, 10);
      ctx.quadraticCurveTo(w - 22, 34, w - 6, 70);
      ctx.quadraticCurveTo(w / 2, 76, 6, 70);
      ctx.quadraticCurveTo(22, 34, w / 2, 10);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Camadas texturizadas de feixes de palha no telhado
      ctx.strokeStyle = 'rgba(66, 32, 6, 0.55)';
      ctx.lineWidth = 2;
      for (let row = 28; row <= 58; row += 14) {
        const span = (row - 8) * 1.9;
        ctx.beginPath();
        ctx.moveTo(w / 2 - span, row);
        ctx.quadraticCurveTo(w / 2, row + 6, w / 2 + span, row);
        ctx.stroke();
      }

      // Vigas cruzadas na cumeeira do telhado da cabana
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 8, 18);
      ctx.lineTo(w / 2 + 8, 4);
      ctx.moveTo(w / 2 + 8, 18);
      ctx.lineTo(w / 2 - 8, 4);
      ctx.stroke();
    });

    // 4. Ponte de Madeira 2.5D com Arcos e Postes de Lanterna (420x170)
    this.createCanvas(scene, 'building_bridge_25d', 420, 170, (ctx, w, h) => {
      // Sombra sob a ponte
      ctx.fillStyle = 'rgba(2, 12, 27, 0.55)';
      ctx.fillRect(12, 34, w - 24, h - 42);

      // Piso de pranchas de carvalho com contorno cel-shaded
      const planks = 18;
      const pw = (w - 24) / planks;
      for (let i = 0; i < planks; i++) {
        const px = 12 + i * pw;
        ctx.fillStyle = i % 2 === 0 ? '#854d0e' : '#713f12';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(px, 26, pw - 1, h - 52, 3);
        ctx.fill();
        ctx.stroke();
      }

      // Corrimão Superior e Inferior 2.5D com Pilares de Madeira e Cordas
      [14, h - 32].forEach((ry) => {
        ctx.fillStyle = '#451a03';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.roundRect(8, ry, w - 16, 14, 4);
        ctx.fill();
        ctx.stroke();

        for (let x = 20; x <= w - 24; x += 52) {
          ctx.fillStyle = '#a16207';
          ctx.beginPath();
          ctx.roundRect(x - 6, ry - 6, 12, 22, 3);
          ctx.fill();
          ctx.stroke();
        }
      });
    });

    // 5. Poço Coberto 2.5D com Telhadinho e Balde (96x110)
    this.createCanvas(scene, 'building_well_25d', 96, 110, (ctx, w, h) => {
      const cx = w / 2;

      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.ellipse(cx, 96, 36, 11, 0, 0, Math.PI * 2);
      ctx.fill();

      // Muro cilindrico de pedras do poço
      ctx.fillStyle = '#64748b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(cx - 28, 60, 56, 34, 8);
      ctx.fill();
      ctx.stroke();

      // Água azul brilhante no topo do cilindro
      ctx.fillStyle = '#0284c7';
      ctx.beginPath();
      ctx.ellipse(cx, 62, 26, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Colunas de madeira laterais
      ctx.fillStyle = '#5c2d0c';
      ctx.fillRect(cx - 24, 26, 6, 38);
      ctx.fillRect(cx + 18, 26, 6, 38);
      ctx.strokeRect(cx - 24, 26, 6, 38);
      ctx.strokeRect(cx + 18, 26, 6, 38);

      // Telhadinho de madeira 2.5D
      ctx.fillStyle = '#92400e';
      ctx.beginPath();
      ctx.moveTo(cx, 8);
      ctx.lineTo(cx + 34, 32);
      ctx.lineTo(cx - 34, 32);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });

    // 6. Forja da Ferraria 2.5D com Bigorna e Fogo Vivo (120x110)
    this.createCanvas(scene, 'building_forge_25d', 120, 110, (ctx, w, h) => {
      const cx = w / 2;

      // Halo de calor laranja no chão
      const glow = ctx.createRadialGradient(cx, 60, 8, cx, 60, 54);
      glow.addColorStop(0, 'rgba(249, 115, 22, 0.75)');
      glow.addColorStop(1, 'rgba(249, 115, 22, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, 60, 54, 0, Math.PI * 2);
      ctx.fill();

      // Fornalha de pedra em arco
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(22, 24, 76, 56, 10);
      ctx.fill();
      ctx.stroke();

      // Boca de fogo incandescente
      const fire = ctx.createRadialGradient(cx, 58, 2, cx, 58, 22);
      fire.addColorStop(0, '#fef08a');
      fire.addColorStop(0.5, '#f97316');
      fire.addColorStop(1, '#991b1b');
      ctx.fillStyle = fire;
      ctx.beginPath();
      ctx.arc(cx, 62, 20, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Bigorna de ferro na frente
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.roundRect(cx - 16, 84, 32, 14, 4);
      ctx.fill();
      ctx.stroke();
    });
  }

  /**
   * Desenha 3 frames de animação (0 = parado, 1 = passo esquerdo, 2 = passo direito)
   * para CADA UMA DAS 20 CLASSES em perspectiva 2.5D (76x92).
   * Todos têm contorno escuro forte, botas animadas, roupa característica, rosto expressivo,
   * olhos com brilho vivo, chapéu/acessório da classe e item na mão!
   */
  private static createAll20ClassCharacterFrames(scene: Phaser.Scene) {
    for (const cls of CLASSES_LIST) {
      for (let frame = 0; frame < 3; frame++) {
        this.createCanvas(scene, `hero_${cls.id}_${frame}`, 76, 92, (ctx, w, h) => {
          this.drawStylizedCharacter25D(ctx, cls.id, cls.colorHex, frame, w, h);
        });
      }
    }
  }

  private static drawStylizedCharacter25D(
    ctx: CanvasRenderingContext2D,
    classId: ClassId,
    primaryHex: string,
    frame: number,
    w: number,
    h: number
  ) {
    const cx = w / 2;
    const bounceY = frame === 0 ? 0 : -3;

    // 1. Sombra oval suave aos pés do personagem
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(cx, 82, 20, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 2. Capa traseira esvoaçante
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.ellipse(cx, 54 + bounceY, 19, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Botas / Pernas Animadas (Frame 1 e 2 alternam a passada)
    const leftLegY = frame === 1 ? 68 : frame === 2 ? 75 : 72;
    const rightLegY = frame === 2 ? 68 : frame === 1 ? 75 : 72;

    ctx.fillStyle = '#451a03';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.6;
    // Bota esquerda
    ctx.beginPath();
    ctx.roundRect(cx - 12, leftLegY, 10, 11, 5);
    ctx.fill();
    ctx.stroke();
    // Bota direita
    ctx.beginPath();
    ctx.roundRect(cx + 2, rightLegY, 10, 11, 5);
    ctx.fill();
    ctx.stroke();

    // 4. Torso / Traje específico da classe
    ctx.fillStyle = primaryHex;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.roundRect(cx - 15, 42 + bounceY, 30, 30, 10);
    ctx.fill();
    ctx.stroke();

    // Detalhes de vestimenta no peito conforme a classe
    this.drawOutfitDetails(ctx, classId, cx, 42 + bounceY);

    // 5. Cabeça Grande Expressiva (Estilo Cartoon 2.5D)
    ctx.fillStyle = '#fde6cd';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.arc(cx, 28 + bounceY, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Bochechas coradas sutis
    ctx.fillStyle = 'rgba(244, 114, 182, 0.35)';
    ctx.beginPath();
    ctx.ellipse(cx - 8, 32 + bounceY, 3, 2, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 8, 32 + bounceY, 3, 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Olhos expressivos com pupila e brilho branco
    [-5.5, 5.5].forEach((ox) => {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.ellipse(cx + ox, 28 + bounceY, 2.6, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Brilho vivo no olho
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + ox - 0.8, 26.5 + bounceY, 1.1, 0, Math.PI * 2);
      ctx.fill();
    });

    // 6. Chapéu / Capuz / Cabelo característico da classe
    this.drawClassHeadgear(ctx, classId, primaryHex, cx, 28 + bounceY);

    // 7. Mãos e Ferramenta / Arma segurada na frente
    this.drawClassHandheldProp(ctx, classId, cx, 55 + bounceY);
  }

  private static drawOutfitDetails(
    ctx: CanvasRenderingContext2D,
    classId: ClassId,
    cx: number,
    topY: number
  ) {
    ctx.save();
    if (classId === 'padre' || classId === 'freira' || classId === 'sacerdote') {
      // Colarinho clerical branco e cruz dourada no peito
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(cx - 5, topY + 1, 10, 4);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, topY + 8);
      ctx.lineTo(cx, topY + 21);
      ctx.moveTo(cx - 5, topY + 13);
      ctx.lineTo(cx + 5, topY + 13);
      ctx.stroke();
    } else if (classId === 'lenhador' || classId === 'marceneiro') {
      // Suspensórios e camisa xadrez
      ctx.fillStyle = '#78350f';
      ctx.fillRect(cx - 9, topY + 2, 4, 26);
      ctx.fillRect(cx + 5, topY + 2, 4, 26);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cx - 14, topY + 20, 28, 5);
    } else if (classId === 'ferreiro' || classId === 'ferreira_armadilhas') {
      // Avental de couro escuro de forja
      ctx.fillStyle = '#451a03';
      ctx.beginPath();
      ctx.roundRect(cx - 10, topY + 5, 20, 23, 4);
      ctx.fill();
    } else {
      // Cinto com fivela dourada e túnica transpassada
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(cx - 14, topY + 19, 28, 5);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(cx - 4, topY + 18, 8, 7);
    }
    ctx.restore();
  }

  private static drawClassHeadgear(
    ctx: CanvasRenderingContext2D,
    classId: ClassId,
    primaryHex: string,
    cx: number,
    headY: number
  ) {
    ctx.save();
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.5;

    switch (classId) {
      case 'cacador':
      case 'inquisidor':
      case 'vigia_noturno': {
        // Chapéu de Aba Larga / Caçador de Lobisomens (Estilo Van Helsing)
        ctx.fillStyle = classId === 'inquisidor' ? '#7f1d1d' : '#1e293b';
        // Copa alta do chapéu
        ctx.beginPath();
        ctx.moveTo(cx - 12, headY - 9);
        ctx.lineTo(cx - 8, headY - 24);
        ctx.lineTo(cx + 8, headY - 24);
        ctx.lineTo(cx + 12, headY - 9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Faixa com fivela dourada
        ctx.fillStyle = '#eab308';
        ctx.fillRect(cx - 10, headY - 14, 20, 4);

        // Aba larga curva
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.ellipse(cx, headY - 9, 21, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'freira': {
        // Véu Branco e Preto de Freira
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.arc(cx, headY - 3, 16, Math.PI, 0);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(cx, headY - 5, 17, Math.PI * 0.9, Math.PI * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'prefeito':
      case 'juiz': {
        // Cartola Elegante / Peruca de Magistrado com Insígnia Dourada
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.roundRect(cx - 11, headY - 26, 22, 18, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#facc15';
        ctx.fillRect(cx - 11, headY - 13, 22, 4);

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.ellipse(cx, headY - 9, 17, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }

      case 'bardo':
      case 'pastor':
      case 'cartografo': {
        // Boina com Pluma Colorida
        ctx.fillStyle = primaryHex;
        ctx.beginPath();
        ctx.ellipse(cx, headY - 12, 17, 7, -0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Pluma branca/dourada
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.quadraticCurveTo(cx + 14, headY - 26, cx + 20, headY - 22);
        ctx.quadraticCurveTo(cx + 14, headY - 14, cx + 8, headY - 14);
        ctx.fill();
        ctx.stroke();
        break;
      }

      default: {
        // Capuz Medieval ou Gorro Estilizado com Franja de Cabelo
        ctx.fillStyle = '#451a03';
        ctx.beginPath();
        ctx.arc(cx, headY - 4, 15, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();

        ctx.fillStyle = primaryHex;
        ctx.beginPath();
        ctx.moveTo(cx - 16, headY - 4);
        ctx.quadraticCurveTo(cx, headY - 25, cx + 16, headY - 4);
        ctx.quadraticCurveTo(cx, headY - 11, cx - 16, headY - 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private static drawClassHandheldProp(
    ctx: CanvasRenderingContext2D,
    classId: ClassId,
    cx: number,
    handY: number
  ) {
    ctx.save();
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.2;

    // Mão esquerda
    ctx.fillStyle = '#fde6cd';
    ctx.beginPath();
    ctx.arc(cx - 15, handY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Item segurado na mão direita (cx + 16)
    const hx = cx + 16;

    if (classId === 'lenhador' || classId === 'ferreiro' || classId === 'coveiro') {
      // Machado / Pá / Martelo
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.roundRect(hx - 2, handY - 18, 5, 28, 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(hx, handY - 16);
      ctx.lineTo(hx + 12, handY - 22);
      ctx.lineTo(hx + 12, handY - 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (classId === 'cacador' || classId === 'inquisidor') {
      // Besta / Pistola de Prata
      ctx.fillStyle = '#78350f';
      ctx.beginPath();
      ctx.roundRect(hx - 2, handY - 5, 16, 6, 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hx + 10, handY - 2, 10, -1.2, 1.2);
      ctx.stroke();
    } else if (
      classId === 'vigia_noturno' ||
      classId === 'padre' ||
      classId === 'freira' ||
      classId === 'medium'
    ) {
      // Lanterna / Relíquia Luminosa
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(hx + 3, handY + 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Frasco de Poção / Pergaminho / Ferramenta
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(hx + 2, handY, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Mão direita por cima do cabo
    ctx.fillStyle = '#fde6cd';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(hx, handY, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  /**
   * Desenha 3 frames animados do LOBISOMEM BÍPEDE 2.5D (96x108):
   * Corpo imponente de fera, juba negra/carmesim, orelhas pontudas, olhos vermelhos incandescentes,
   * mandíbula com presas brancas e garras gigantes animadas.
   */
  private static createWerewolf25DFrames(scene: Phaser.Scene) {
    for (let frame = 0; frame < 3; frame++) {
      this.createCanvas(scene, `werewolf_25d_${frame}`, 96, 108, (ctx, w, h) => {
        const cx = w / 2;
        const bounceY = frame === 0 ? 0 : -4;

        // Aura de Lua de Sangue sob os pés
        const aura = ctx.createRadialGradient(cx, 92, 4, cx, 92, 34);
        aura.addColorStop(0, 'rgba(220, 38, 38, 0.55)');
        aura.addColorStop(1, 'rgba(220, 38, 38, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(cx, 92, 34, 12, 0, 0, Math.PI * 2);
        ctx.fill();

        // Pernas lupinas articuladas
        const leftY = frame === 1 ? 74 : frame === 2 ? 82 : 78;
        const rightY = frame === 2 ? 74 : frame === 1 ? 82 : 78;

        ctx.fillStyle = '#1f1216';
        ctx.strokeStyle = '#090507';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(cx - 16, leftY, 12, 16, 5);
        ctx.roundRect(cx + 4, rightY, 12, 16, 5);
        ctx.fill();
        ctx.stroke();

        // Torso Musculoso com Pelagem Rasgada
        const torsoGrad = ctx.createLinearGradient(0, 36, 0, 82);
        torsoGrad.addColorStop(0, '#3b1922');
        torsoGrad.addColorStop(1, '#1a0a0e');
        ctx.fillStyle = torsoGrad;

        ctx.beginPath();
        ctx.moveTo(cx - 24, 44 + bounceY);
        ctx.lineTo(cx + 24, 44 + bounceY);
        ctx.lineTo(cx + 16, 80 + bounceY);
        ctx.lineTo(cx - 16, 80 + bounceY);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Braços longos e Garras Afiadas
        [-26, 26].forEach((bx) => {
          const dir = bx < 0 ? -1 : 1;
          ctx.fillStyle = '#291117';
          ctx.beginPath();
          ctx.roundRect(cx + bx - 6, 46 + bounceY, 12, 26, 6);
          ctx.fill();
          ctx.stroke();

          // 3 Garras brancas/carmesim na ponta da pata
          ctx.strokeStyle = '#f8fafc';
          ctx.lineWidth = 2.4;
          for (let c = -1; c <= 1; c++) {
            ctx.beginPath();
            ctx.moveTo(cx + bx + c * 3, 72 + bounceY);
            ctx.lineTo(cx + bx + c * 4 + dir * 3, 81 + bounceY);
            ctx.stroke();
          }
          ctx.strokeStyle = '#090507';
          ctx.lineWidth = 3;
        });

        // Cabeça de Lobo Feroz com Orelhas Pontudas
        ctx.fillStyle = '#2d1219';
        // Orelha esquerda e direita
        [-14, 14].forEach((ex) => {
          ctx.beginPath();
          ctx.moveTo(cx + ex - 6, 26 + bounceY);
          ctx.lineTo(cx + ex * 1.35, 6 + bounceY);
          ctx.lineTo(cx + ex + 6, 26 + bounceY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });

        // Crânio lupino
        ctx.beginPath();
        ctx.arc(cx, 32 + bounceY, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Mandíbula com presas brancas afiadas
        ctx.fillStyle = '#7f1d1d';
        ctx.beginPath();
        ctx.roundRect(cx - 10, 38 + bounceY, 20, 8, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        [-6, -2, 2, 6].forEach((tx) => {
          ctx.beginPath();
          ctx.moveTo(cx + tx - 2, 39 + bounceY);
          ctx.lineTo(cx + tx, 44 + bounceY);
          ctx.lineTo(cx + tx + 2, 39 + bounceY);
          ctx.fill();
        });

        // Olhos Vermelhos Brilhantes em Fúria
        ctx.fillStyle = '#ef4444';
        [-7, 7].forEach((ox) => {
          ctx.beginPath();
          ctx.moveTo(cx + ox - 4, 28 + bounceY);
          ctx.lineTo(cx + ox + 4, 30 + bounceY);
          ctx.lineTo(cx + ox, 33 + bounceY);
          ctx.closePath();
          ctx.fill();
        });
      });
    }
  }

  private static createInteractiveProps(scene: Phaser.Scene) {
    // 1. Totem Rúnico 2.5D (Intacto vs Destruído)
    this.createCanvas(scene, 'prop_totem_active_25d', 68, 84, (ctx, w, h) => {
      const cx = w / 2;

      const glow = ctx.createRadialGradient(cx, 44, 4, cx, 44, 32);
      glow.addColorStop(0, 'rgba(192, 132, 252, 0.75)');
      glow.addColorStop(1, 'rgba(192, 132, 252, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, 44, 32, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#312e81';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, 10);
      ctx.lineTo(cx + 15, 26);
      ctx.lineTo(cx + 12, 72);
      ctx.lineTo(cx - 12, 72);
      ctx.lineTo(cx - 15, 26);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Runa brilhante esculpida
      ctx.strokeStyle = '#e9d5ff';
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.moveTo(cx, 24);
      ctx.lineTo(cx, 58);
      ctx.moveTo(cx - 7, 34);
      ctx.lineTo(cx + 7, 46);
      ctx.moveTo(cx + 7, 34);
      ctx.lineTo(cx - 7, 46);
      ctx.stroke();
    });

    this.createCanvas(scene, 'prop_totem_broken_25d', 68, 84, (ctx, w, h) => {
      const cx = w / 2;
      ctx.fillStyle = '#475569';
      ctx.strokeStyle = '#090d16';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(cx - 14, 54, 28, 18, 4);
      ctx.fill();
      ctx.stroke();
    });

    // 2. Armadilha de Caça Metálica 2.5D (52x44)
    this.createCanvas(scene, 'prop_trap_25d', 52, 44, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;

      ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 22, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#64748b';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 17, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // 3. Cadáveres Personalizados por Classe Estilo Among Us + Lobisomem (88x68):
    // Metade inferior caída na poça carmesim com a cor do traje da vítima, osso branco central exposto,
    // marcas de garras rasgadas e o chapéu/capuz da vítima caído ao lado!
    for (const cls of CLASSES_LIST) {
      this.createCanvas(scene, `corpse_${cls.id}_25d`, 88, 68, (ctx) => {
        this.drawSeveredCorpse25D(ctx, cls.colorHex);
      });
    }
    // Fallback padrão
    this.createCanvas(scene, 'prop_corpse_25d', 88, 68, (ctx) => {
      this.drawSeveredCorpse25D(ctx, '#64748b');
    });

    // 4. VFX de Rasgo Triplo de Garras no Mapa (110x110)
    this.createCanvas(scene, 'vfx_claw_slash_25d', 110, 110, (ctx, w, h) => {
      ctx.save();
      for (let i = -1; i <= 1; i++) {
        const offset = i * 24;
        // Sombra/halo vermelho da garra
        ctx.strokeStyle = '#dc2626';
        ctx.lineWidth = 10;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(16 + offset * 0.5, 16 - offset * 0.5);
        ctx.quadraticCurveTo(w / 2 + offset, h / 2, w - 16 + offset * 0.5, h - 16 - offset * 0.5);
        ctx.stroke();

        // Núcleo branco/amarelo incandescente do corte
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(20 + offset * 0.5, 20 - offset * 0.5);
        ctx.quadraticCurveTo(w / 2 + offset, h / 2, w - 20 + offset * 0.5, h - 20 - offset * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  private static drawSeveredCorpse25D(ctx: CanvasRenderingContext2D, suitHex: string) {
    const cx = 44;
    const cy = 38;

    // 1. Poça de sangue estilizada Cel-Shaded com respingos ao redor
    ctx.fillStyle = '#7f1d1d';
    ctx.strokeStyle = '#450a0a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, 34, 15, -0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Respingos menores da poça
    ctx.fillStyle = '#991b1b';
    ctx.beginPath();
    ctx.ellipse(cx - 28, cy + 14, 7, 3.5, 0.2, 0, Math.PI * 2);
    ctx.ellipse(cx + 31, cy - 2, 6, 3, -0.3, 0, Math.PI * 2);
    ctx.ellipse(cx + 22, cy + 16, 8, 4, 0.1, 0, Math.PI * 2);
    ctx.fill();

    // 2. Botas / Pernas caídas de lado (Esquerda)
    ctx.fillStyle = '#451a03';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.roundRect(cx - 34, cy - 5, 13, 9, 4);
    ctx.roundRect(cx - 32, cy + 5, 13, 9, 4);
    ctx.fill();
    ctx.stroke();

    // 3. Torso Inferior Cortado ao Meio (Com a cor da roupa da vítima!)
    ctx.fillStyle = suitHex;
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(cx - 23, cy - 9, 28, 24, 9);
    ctx.fill();
    ctx.stroke();

    // Cinto escuro da roupa
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(cx - 18, cy - 8, 5, 22);

    // Interior do corte transversal (Carne escura estilo Among Us)
    ctx.fillStyle = '#991b1b';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.ellipse(cx + 5, cy + 3, 7, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 4. Osso Branco Central Exposto saindo do corte (Ícone clássico de corpo do Among Us!)
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 2.5;
    // Haste do osso
    ctx.beginPath();
    ctx.roundRect(cx + 4, cy - 1, 16, 7, 3);
    ctx.fill();
    ctx.stroke();
    // Duas pontas arredondadas da epífise do osso
    ctx.beginPath();
    ctx.arc(cx + 20, cy - 1, 4.5, 0, Math.PI * 2);
    ctx.arc(cx + 20, cy + 6, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 5. Chapéu / Capuz da vítima caído no chão à direita
    ctx.fillStyle = suitHex;
    ctx.beginPath();
    ctx.arc(cx + 26, cy - 10, 9, Math.PI * 0.9, Math.PI * 2.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 6. Três marcas diagonais brilhantes de garras sobre o corpo
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 17 + i * 5, cy - 7);
      ctx.lineTo(cx - 7 + i * 5, cy + 9);
      ctx.stroke();
    }
  }

  private static createLightingMask(scene: Phaser.Scene) {
    // 1. Vinheta GPU ultra-leve (256x256) com centro transparente e bordas escuras suaves:
    // 16x menos memória de vídeo que 1024x1024 com interpolação linear idêntica na GPU!
    this.createCanvas(scene, 'vignette_vision', 256, 256, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const r = w * 0.48;
      const grad = ctx.createRadialGradient(cx, cy, r * 0.25, cx, cy, r);
      grad.addColorStop(0, 'rgba(3, 6, 14, 0)');
      grad.addColorStop(0.45, 'rgba(3, 6, 14, 0.18)');
      grad.addColorStop(0.75, 'rgba(3, 6, 14, 0.72)');
      grad.addColorStop(1, 'rgba(3, 6, 14, 0.95)');

      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });

    // 2. Halo estático de luz de tocha / fogo antigo (96x96 - super leve)
    this.createCanvas(scene, 'warm_lamp_glow', 96, 96, (ctx, w, h) => {
      const cx = w / 2;
      const cy = h / 2;
      const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 46);
      grad.addColorStop(0, 'rgba(254, 240, 138, 0.44)');
      grad.addColorStop(0.42, 'rgba(249, 115, 22, 0.24)');
      grad.addColorStop(0.75, 'rgba(234, 88, 12, 0.08)');
      grad.addColorStop(1, 'rgba(234, 88, 12, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
