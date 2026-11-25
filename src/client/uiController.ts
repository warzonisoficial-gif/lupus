import { Socket } from 'socket.io-client';
import { CLASSES_BY_ID, CLASSES_LIST } from '../shared/classesData';
import {
  BARRICADE_INTERACT_RADIUS,
  BARREL_INTERACT_RADIUS,
  BELL_INTERACT_RADIUS,
  CHURCH_CENTER,
  HIDING_BARRELS,
  TOMB_INTERACT_RADIUS,
  VILLAGE_ZONES,
  WEREWOLF_TOMBS,
  isPlayerInCover,
  isPointInZone
} from '../shared/mapData';
import { getAccountLevelFromXp } from '../shared/progressionData';
import { ClassId, PlayerState, WorldSnapshot } from '../shared/types';
import { VillageScene } from './VillageScene';

export class UIController {
  private socket: Socket;
  private scene: VillageScene | null = null;
  private latestSnapshot: WorldSnapshot | null = null;
  private selectedTurn1Suspect: string | null = null;
  private lastPortraitClass: string = '';
  private lastKillFeedTopId: string = '';
  private lastTribunalTurnRendered: string = '';
  private wasLocalPlayerAlive: boolean = true;

  private wheelAngleDeg: number = 0;
  private wheelSpinning: boolean = false;
  private wheelAnimId: number | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    this.bindEvents();
    this.setupVirtualJoystick();
  }

  public attachScene(scene: VillageScene) {
    this.scene = scene;
  }

  private getCharacterPortraitDataUrl(classId: ClassId, isTransformed = false): string {
    if (!this.scene) return '';
    const key = isTransformed ? 'werewolf_25d_0' : `hero_${classId}_0`;
    if (!this.scene.textures.exists(key)) return '';
    return this.scene.textures.getBase64(key);
  }

  private getCorpseDataUrl(classId: ClassId): string {
    if (!this.scene) return '';
    const key = this.scene.textures.exists(`corpse_${classId}_25d`)
      ? `corpse_${classId}_25d`
      : 'prop_corpse_25d';
    if (!this.scene.textures.exists(key)) return '';
    return this.scene.textures.getBase64(key);
  }

  /**
   * Dispara a Cinemática de Abate Estilo Among Us:
   * A tela escurece, o Lobisomem avança, 3 rasgos gigantes de garras cortam a tela e o boneco
   * é partido ao meio (virando o cadáver da classe com o osso exposto)!
   */
  public playWerewolfKillCinematic(victimClass: ClassId) {
    const overlay = document.getElementById('kill-cinematic-overlay');
    const attackerImg = document.getElementById('kill-attacker-img') as HTMLImageElement | null;
    const victimAliveImg = document.getElementById('kill-victim-alive-img') as HTMLImageElement | null;
    const victimCorpseImg = document.getElementById('kill-victim-corpse-img') as HTMLImageElement | null;

    if (!overlay || !attackerImg || !victimAliveImg || !victimCorpseImg) return;

    attackerImg.src = this.getCharacterPortraitDataUrl(victimClass, true);
    victimAliveImg.src = this.getCharacterPortraitDataUrl(victimClass, false);
    victimCorpseImg.src = this.getCorpseDataUrl(victimClass);

    victimAliveImg.classList.remove('hidden');
    victimCorpseImg.classList.add('hidden');

    // Reinicia animações CSS removendo e readicionando o overlay
    overlay.classList.add('hidden');
    void overlay.offsetWidth;
    overlay.classList.remove('hidden');

    // No exato momento em que as 3 garras rasgam a tela (320ms), fatia o personagem ao meio!
    window.setTimeout(() => {
      victimAliveImg.classList.add('hidden');
      victimCorpseImg.classList.remove('hidden');
    }, 320);

    // Fecha a cinemática após 2.5s liberando o jogador como Fantasma
    window.setTimeout(() => {
      overlay.classList.add('hidden');
    }, 2500);
  }

  public showToast(message: string) {
    const toast = document.getElementById('tactical-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('hidden');
    window.clearTimeout((toast as any)._timer);
    (toast as any)._timer = window.setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  private setupVirtualJoystick() {
    const zone = document.getElementById('joystick-zone');
    const knob = document.getElementById('joystick-knob');
    if (!zone || !knob) return;

    let active = false;
    const maxRadius = 36;

    const updateStick = (clientX: number, clientY: number) => {
      const rect = zone.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const rawDx = clientX - centerX;
      const rawDy = clientY - centerY;
      const dist = Math.hypot(rawDx, rawDy);
      const clampedDist = Math.min(maxRadius, dist);
      const angle = Math.atan2(rawDy, rawDx);

      const offsetX = Math.cos(angle) * clampedDist;
      const offsetY = Math.sin(angle) * clampedDist;

      knob.style.transform = `translate(${offsetX}px, ${offsetY}px)`;

      if (this.scene) {
        if (dist > 6) {
          this.scene.joystickDx = offsetX / maxRadius;
          this.scene.joystickDy = offsetY / maxRadius;
        } else {
          this.scene.joystickDx = 0;
          this.scene.joystickDy = 0;
        }
      }
    };

    const resetStick = () => {
      active = false;
      knob.style.transform = 'translate(0px, 0px)';
      if (this.scene) {
        this.scene.joystickDx = 0;
        this.scene.joystickDy = 0;
      }
    };

    zone.addEventListener('pointerdown', (e) => {
      active = true;
      zone.setPointerCapture(e.pointerId);
      updateStick(e.clientX, e.clientY);
    });

    zone.addEventListener('pointermove', (e) => {
      if (!active) return;
      updateStick(e.clientX, e.clientY);
    });

    zone.addEventListener('pointerup', resetStick);
    zone.addEventListener('pointercancel', resetStick);
  }

  private bindEvents() {
    document.getElementById('btn-action-mission')?.addEventListener('click', () => {
      this.socket.emit('mission_interact', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-action-ability')?.addEventListener('click', () => {
      this.socket.emit('use_ability', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-action-report')?.addEventListener('click', () => {
      this.socket.emit('report_or_bell', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-action-transform')?.addEventListener('click', () => {
      this.socket.emit('werewolf_transform', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-action-barrel')?.addEventListener('click', () => {
      this.socket.emit('toggle_barrel', (res: any) => {
        if (res?.ok && this.scene && typeof res.x === 'number' && typeof res.y === 'number') {
          this.scene.predictedX = res.x;
          this.scene.predictedY = res.y;
        }
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-action-tomb')?.addEventListener('click', () => {
      this.socket.emit('toggle_tomb', (res: any) => {
        if (res?.ok && this.scene && typeof res.x === 'number' && typeof res.y === 'number') {
          this.scene.predictedX = res.x;
          this.scene.predictedY = res.y;
        }
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-action-barricade')?.addEventListener('click', () => {
      this.socket.emit('barricade_interact', (res: { ok: boolean; message: string }) => {
        if (res?.message) this.showToast(res.message);
      });
    });

    document.getElementById('btn-toggle-drawer')?.addEventListener('click', () => {
      document.getElementById('tactical-drawer')?.classList.toggle('hidden');
    });

    document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
      document.getElementById('tactical-drawer')?.classList.add('hidden');
    });

    document.getElementById('btn-start-match')?.addEventListener('click', () => {
      this.socket.emit('start_match', 9);
      this.showToast('Nova partida iniciada com 9 jogadores!');
    });

    document.getElementById('btn-test-wolf')?.addEventListener('click', () => {
      this.socket.emit('debug_role', 'WEREWOLF');
      this.showToast('Você agora é o Lobisomem (com Escape ativo)!');
    });

    document.getElementById('btn-test-hunter')?.addEventListener('click', () => {
      this.socket.emit('debug_role', 'HUNTER_VILLAGER');
      this.showToast('Você agora é o Caçador com 2 Armadilhas prontas!');
    });

    document.getElementById('btn-test-tribunal')?.addEventListener('click', () => {
      this.socket.emit('debug_role', 'FORCE_TRIBUNAL');
    });

    document.getElementById('btn-test-bloodmoon')?.addEventListener('click', () => {
      this.socket.emit('debug_role', 'FORCE_BLOOD_MOON');
      this.showToast('FASE 3: Lua de Sangue iniciada (90s)!');
    });

    document.getElementById('btn-test-kill-anim')?.addEventListener('click', () => {
      const me = this.latestSnapshot?.players.find((p) => p.id === this.socket.id);
      document.getElementById('tactical-drawer')?.classList.add('hidden');
      this.playWerewolfKillCinematic(me?.classId || 'aldeao');
    });

    document.getElementById('btn-test-wheel')?.addEventListener('click', () => {
      this.openVictoryWheelModal(
        'VILLAGE',
        'Demonstração Interativa da Roda da Vitória (Skill Check Pós-Jogo)'
      );
    });

    document.getElementById('btn-open-classes')?.addEventListener('click', () => {
      this.renderClassesCatalog();
      document.getElementById('modal-classes')?.classList.remove('hidden');
    });

    document.getElementById('btn-close-classes')?.addEventListener('click', () => {
      document.getElementById('modal-classes')?.classList.add('hidden');
    });

    document.getElementById('btn-skip-tribunal-turn')?.addEventListener('click', () => {
      this.socket.emit('tribunal_skip_turn');
    });

    document.getElementById('btn-verdict-a')?.addEventListener('click', () => {
      this.socket.emit('tribunal_vote', 'A');
      this.showToast('Voto registrado: Executar Acusado A');
    });

    document.getElementById('btn-verdict-b')?.addEventListener('click', () => {
      this.socket.emit('tribunal_vote', 'B');
      this.showToast('Voto registrado: Executar Acusado B');
    });

    document.getElementById('btn-verdict-absolve')?.addEventListener('click', () => {
      this.socket.emit('tribunal_vote', 'ABSOLVE');
      this.showToast('Voto registrado: Absolver Ambos');
    });

    document.getElementById('btn-close-wheel')?.addEventListener('click', () => {
      this.stopWheelLoop();
      document.getElementById('modal-victory-wheel')?.classList.add('hidden');
    });

    document.getElementById('btn-spin-stop')?.addEventListener('click', () => {
      this.handleSkillCheckTrigger();
    });

    document.getElementById('btn-new-match-from-wheel')?.addEventListener('click', () => {
      this.stopWheelLoop();
      document.getElementById('modal-victory-wheel')?.classList.add('hidden');
      this.socket.emit('start_match', 9);
    });
  }

  public updateFromSnapshot(snap: WorldSnapshot) {
    const prevPhase = this.latestSnapshot?.phase;
    this.latestSnapshot = snap;

    const me = snap.players.find((p) => p.id === this.socket.id);
    if (me) {
      // A tela escurecendo com o ataque de garras só aparece EXCLUSIVAMENTE para a vítima
      // que acabou de ser morta pelas garras do Lobisomem (verificando se surgiu o cadáver dela agora)!
      const killedByWerewolfClaws = snap.corpses.some(
        (c) => c.victimId === me.id && Date.now() - c.diedAt < 4000
      );
      if (this.wasLocalPlayerAlive && !me.isAlive && killedByWerewolfClaws) {
        this.playWerewolfKillCinematic(me.classId);
      }
      this.wasLocalPlayerAlive = me.isAlive;
    }

    this.updateTopHud(snap, me || null);
    if (me) {
      this.updateContextualGameButtons(snap, me);
    }
    this.updateKillFeed(snap);
    this.updateTribunalModal(snap);

    if (snap.phase === 'POST_GAME' && prevPhase !== 'POST_GAME') {
      this.openVictoryWheelModal(
        snap.winner || 'VILLAGE',
        snap.winReason || 'A partida chegou ao fim.'
      );
    }
  }

  private updateTopHud(snap: WorldSnapshot, me: PlayerState | null) {
    const phaseBadge = document.getElementById('hud-phase-badge');
    if (phaseBadge) {
      const labels: Record<string, string> = {
        LOBBY: 'AGUARDANDO',
        PHASE_1_HUNT: 'FASE 1: CAÇA',
        PHASE_2_TRIBUNAL: 'FASE 2: TRIBUNAL',
        PHASE_3_BLOOD_MOON: 'FASE 3: LUA DE SANGUE',
        POST_GAME: 'RODA DA VITÓRIA'
      };
      phaseBadge.textContent = labels[snap.phase] || snap.phase;
    }

    const timerEl = document.getElementById('hud-timer');
    if (timerEl) {
      const m = Math.floor(snap.phaseTimerSec / 60);
      const s = snap.phaseTimerSec % 60;
      timerEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    const eclipseEl = document.getElementById('hud-eclipse');
    if (eclipseEl) {
      eclipseEl.textContent = snap.eclipseActive
        ? `ECLIPSE (${snap.eclipseRemainingSec}s)`
        : `Lua Clara (${snap.eclipseRemainingSec}s)`;
    }

    const bellWrap = document.getElementById('hud-bell-wrap');
    const bellEl = document.getElementById('hud-bell-hp');
    if (bellWrap && bellEl) {
      if (snap.phase === 'PHASE_3_BLOOD_MOON') {
        bellWrap.classList.remove('hidden');
        bellEl.textContent = `Sino: ${snap.churchBellHp} HP`;
      } else {
        bellWrap.classList.add('hidden');
      }
    }

    if (me) {
      const level = getAccountLevelFromXp(me.totalXp);
      const lvlEl = document.getElementById('hud-account-level');
      const xpEl = document.getElementById('hud-account-xp');
      if (lvlEl) lvlEl.textContent = `Nv.${level}`;
      if (xpEl) xpEl.textContent = `${me.totalXp.toLocaleString('pt-BR')} XP`;

      const portraitKey = `${me.classId}_${me.isTransformed}`;
      if (this.lastPortraitClass !== portraitKey) {
        const url = this.getCharacterPortraitDataUrl(me.classId, me.isTransformed);
        const imgEl = document.getElementById('hud-hero-portrait') as HTMLImageElement | null;
        if (imgEl && url) {
          imgEl.src = url;
          this.lastPortraitClass = portraitKey;
        }
      }
    }
  }

  /**
   * Atualiza as barras de progresso e exibe/esconde os Botões de Ação Contextualmente
   * para que NENHUM botão polua a tela quando o jogador estiver longe da interação!
   */
  private updateContextualGameButtons(snap: WorldSnapshot, me: PlayerState) {
    const cls = CLASSES_BY_ID[me.classId];

    const titleEl = document.getElementById('player-role-title');
    if (titleEl) {
      titleEl.textContent = me.isTransformed ? 'Lobisomem' : cls.name;
    }

    const alignEl = document.getElementById('player-secret-alignment');
    if (alignEl) {
      if (me.isWerewolf) {
        alignEl.textContent = me.hasEscapePassive ? 'LOBO • ESCAPE PRONTO' : 'LOBO INFILTRADO';
        alignEl.classList.add('alignment-wolf');
      } else {
        alignEl.textContent = me.isAlive ? 'MORADOR DA VILA' : 'FANTASMA';
        alignEl.classList.remove('alignment-wolf');
      }
    }

    const descEl = document.getElementById('player-ability-desc');
    if (descEl) {
      descEl.textContent = `${cls.abilityName}: ${cls.abilityDescription}`;
    }

    // 1. Barra de Progresso de Missão Estilo Jogo
    const missionLabel = document.getElementById('mission-label');
    const missionPct = document.getElementById('mission-pct');
    const missionBar = document.getElementById('mission-bar');
    if (missionLabel) missionLabel.textContent = cls.missionTitle;
    if (missionPct) {
      missionPct.textContent = me.abilityUnlocked ? 'PRONTA' : `${me.missionProgress}%`;
    }
    if (missionBar) missionBar.style.width = `${me.missionProgress}%`;

    // 2. Barra de Passiva ESCAPE (Apenas Lobisomem)
    const escapeBox = document.getElementById('werewolf-escape-box');
    if (me.isWerewolf) {
      escapeBox?.classList.remove('hidden');
      const escapeStatus = document.getElementById('escape-status-text');
      const escapeBar = document.getElementById('escape-bar');
      if (escapeStatus) {
        escapeStatus.textContent = me.hasEscapePassive
          ? 'ATIVO'
          : `${me.totemsDestroyed}/2`;
      }
      if (escapeBar) {
        escapeBar.style.width = me.hasEscapePassive
          ? '100%'
          : `${Math.min(100, me.totemsDestroyed * 50)}%`;
      }
    } else {
      escapeBox?.classList.add('hidden');
    }

    // Se o jogador estiver morto ou fora das fases de ação, esconde todos os orbs de ação
    const btnMission = document.getElementById('btn-action-mission');
    const btnAbility = document.getElementById('btn-action-ability');
    const btnReport = document.getElementById('btn-action-report');
    const btnTransform = document.getElementById('btn-action-transform');
    const btnBarrel = document.getElementById('btn-action-barrel');
    const btnTomb = document.getElementById('btn-action-tomb');
    const btnBarricade = document.getElementById('btn-action-barricade');

    if (
      !me.isAlive ||
      (snap.phase !== 'PHASE_1_HUNT' && snap.phase !== 'PHASE_3_BLOOD_MOON')
    ) {
      btnMission?.classList.add('hidden');
      btnAbility?.classList.add('hidden');
      btnReport?.classList.add('hidden');
      btnTransform?.classList.add('hidden');
      btnBarrel?.classList.add('hidden');
      btnTomb?.classList.add('hidden');
      btnBarricade?.classList.add('hidden');
      return;
    }

    // Se o jogador está removendo uma Barricada de Madeira (4 segundos incanceláveis!),
    // trava todos os outros botões e mostra a contagem regressiva de 4s no botão da barricada!
    const barricadeBtnLabel = document.getElementById('barricade-btn-label');
    if (me.removingBarricadeId) {
      btnMission?.classList.add('hidden');
      btnAbility?.classList.add('hidden');
      btnReport?.classList.add('hidden');
      btnTransform?.classList.add('hidden');
      btnBarrel?.classList.add('hidden');
      btnTomb?.classList.add('hidden');
      btnBarricade?.classList.remove('hidden');
      const remSec = Math.max(0.1, (me.removingBarricadeEndsAt - Date.now()) / 1000).toFixed(1);
      if (barricadeBtnLabel) barricadeBtnLabel.textContent = `${remSec}s`;
      return;
    }

    // --- BOTÃO 0C: COLOCAR MADEIRA (Lobisomem) / REMOVER MADEIRA EM 4s (Qualquer Jogador) [B] ---
    const nearBarSlot = (snap.barricades || []).find(
      (b) => Math.hypot(b.x - me.x, b.y - me.y) <= BARRICADE_INTERACT_RADIUS
    );
    if (nearBarSlot && !me.hiddenInBarrelId && !me.hiddenInTombId) {
      if (nearBarSlot.active) {
        btnBarricade?.classList.remove('hidden');
        if (barricadeBtnLabel) barricadeBtnLabel.textContent = 'REMOVER';
      } else if (me.isWerewolf) {
        btnBarricade?.classList.remove('hidden');
        if (barricadeBtnLabel) barricadeBtnLabel.textContent = 'MADEIRA';
      } else {
        btnBarricade?.classList.add('hidden');
      }
    } else {
      btnBarricade?.classList.add('hidden');
    }

    // --- BOTÃO 0A: ENTRAR / SAIR DO BARRIL DE ESCONDERIJO [F] (Nas Cabanas da Vila) ---
    const nearBarrel = HIDING_BARRELS.some(
      (b) => Math.hypot(b.x - me.x, b.y - me.y) <= BARREL_INTERACT_RADIUS
    );
    const barrelBtnLabel = document.getElementById('barrel-btn-label');
    if (me.hiddenInBarrelId) {
      btnBarrel?.classList.remove('hidden');
      if (barrelBtnLabel) barrelBtnLabel.textContent = 'SAIR';
    } else if (nearBarrel && !(me.isWerewolf && me.isTransformed)) {
      btnBarrel?.classList.remove('hidden');
      if (barrelBtnLabel) barrelBtnLabel.textContent = 'ENTRAR';
    } else {
      btnBarrel?.classList.add('hidden');
    }

    // --- BOTÃO 0B: ENTRAR / SAIR DA TUMBA DO CEMITÉRIO [T] (Exclusivo para o Lobisomem!) ---
    const nearTomb =
      me.isWerewolf &&
      WEREWOLF_TOMBS.some((t) => Math.hypot(t.x - me.x, t.y - me.y) <= TOMB_INTERACT_RADIUS);
    const tombBtnLabel = document.getElementById('tomb-btn-label');
    if (me.isWerewolf && me.hiddenInTombId) {
      btnTomb?.classList.remove('hidden');
      if (tombBtnLabel) tombBtnLabel.textContent = 'SAIR';
    } else if (nearTomb) {
      btnTomb?.classList.remove('hidden');
      if (tombBtnLabel) tombBtnLabel.textContent = 'TUMBA';
    } else {
      btnTomb?.classList.add('hidden');
    }

    // --- BOTÃO 1: MISSÃO / TOTEM [E] (Só aparece quando dentro da Zona da Missão ou perto de Totem!) ---
    const targetZone = VILLAGE_ZONES.find((z) => z.id === cls.missionZone);
    const inMissionZone =
      snap.phase === 'PHASE_1_HUNT' &&
      !me.abilityUnlocked &&
      targetZone &&
      isPointInZone(me.x, me.y, targetZone);

    const nearActiveTotem =
      snap.phase === 'PHASE_1_HUNT' &&
      me.isWerewolf &&
      !me.hasEscapePassive &&
      snap.totems.some((t) => !t.destroyed && Math.hypot(t.x - me.x, t.y - me.y) <= 115);

    const missionBtnLabel = document.getElementById('mission-btn-label');
    if (nearActiveTotem) {
      btnMission?.classList.remove('hidden');
      if (missionBtnLabel) missionBtnLabel.textContent = 'TOTEM';
    } else if (inMissionZone) {
      btnMission?.classList.remove('hidden');
      if (missionBtnLabel) missionBtnLabel.textContent = 'MISSÃO';
    } else {
      btnMission?.classList.add('hidden');
    }

    // --- BOTÃO 2: REPORTAR CORPO / TOCAR SINO [R] (Só aparece perto de cadáver ou perto do Sino da Igreja!) ---
    const nearCorpse =
      snap.phase === 'PHASE_1_HUNT' &&
      snap.corpses.some((c) => !c.reported && Math.hypot(c.x - me.x, c.y - me.y) <= 135);
    const nearChurchBell =
      snap.phase === 'PHASE_1_HUNT' &&
      Math.hypot(me.x - CHURCH_CENTER.x, me.y - CHURCH_CENTER.y) <= BELL_INTERACT_RADIUS + 30;

    const reportBtnLabel = document.getElementById('report-btn-label');
    if (nearCorpse) {
      btnReport?.classList.remove('hidden');
      if (reportBtnLabel) reportBtnLabel.textContent = 'REPORTAR';
    } else if (nearChurchBell) {
      btnReport?.classList.remove('hidden');
      if (reportBtnLabel) reportBtnLabel.textContent = 'SINO';
    } else {
      btnReport?.classList.add('hidden');
    }

    // --- BOTÃO 3: TRANSFORMAR EM LOBO [Q] (Só aparece para o Lobisomem se estiver em Zona Oculta ou já transformado!) ---
    const inCoverZone = isPlayerInCover(me.x, me.y);
    const canToggleWolf =
      me.isWerewolf &&
      snap.phase === 'PHASE_1_HUNT' &&
      (me.isTransformed || inCoverZone);

    const transformLabel = document.getElementById('transform-btn-label');
    if (canToggleWolf) {
      btnTransform?.classList.remove('hidden');
      if (transformLabel) {
        transformLabel.textContent = me.isTransformed ? 'HUMANO' : 'LOBO';
      }
    } else {
      btnTransform?.classList.add('hidden');
    }

    // --- BOTÃO 4: HABILIDADE / ATAQUE [ESPAÇO] (Só aparece quando a habilidade já foi liberada ou em forma de Lobo!) ---
    const abilityTitle = document.getElementById('ability-btn-title');
    const abilityCharges = document.getElementById('ability-btn-charges');

    if (me.isWerewolf && me.isTransformed) {
      btnAbility?.classList.remove('hidden');
      if (abilityTitle) {
        abilityTitle.textContent =
          snap.phase === 'PHASE_3_BLOOD_MOON' ? 'GARRAS' : 'ATACAR';
      }
      if (abilityCharges) abilityCharges.textContent = 'LOBO';
    } else if (me.abilityUnlocked && me.abilityCharges > 0) {
      btnAbility?.classList.remove('hidden');
      if (abilityTitle) {
        abilityTitle.textContent = cls.abilityName.split(' ')[0].toUpperCase();
      }
      if (abilityCharges) abilityCharges.textContent = `${me.abilityCharges}x`;
    } else {
      btnAbility?.classList.add('hidden');
    }
  }

  private updateKillFeed(snap: WorldSnapshot) {
    const aliveCounter = document.getElementById('alive-counter');
    if (aliveCounter) {
      const aliveCount = snap.players.filter((p) => p.isAlive).length;
      aliveCounter.textContent = `${aliveCount}/${snap.players.length} vivos`;
    }

    const topId = snap.killFeed[0]?.id || '';
    if (topId === this.lastKillFeedTopId) return;
    this.lastKillFeedTopId = topId;

    const listEl = document.getElementById('kill-feed-list');
    if (!listEl) return;

    listEl.innerHTML = snap.killFeed.map((item) => `<li>${item.text}</li>`).join('');
  }

  private updateTribunalModal(snap: WorldSnapshot) {
    const modal = document.getElementById('modal-tribunal');
    if (!modal) return;

    if (snap.phase !== 'PHASE_2_TRIBUNAL' || !snap.tribunal) {
      modal.classList.add('hidden');
      this.selectedTurn1Suspect = null;
      this.lastTribunalTurnRendered = '';
      return;
    }

    modal.classList.remove('hidden');
    const trib = snap.tribunal;

    const turnBadge = document.getElementById('tribunal-turn-badge');
    const countdown = document.getElementById('tribunal-countdown');
    const reasonEl = document.getElementById('tribunal-reason');
    const cluesEl = document.getElementById('tribunal-clues-list');
    const votesStatus = document.getElementById('tribunal-votes-status');

    const remSec = Math.max(0, Math.ceil((trib.turnEndsAt - Date.now()) / 1000));
    if (countdown) countdown.textContent = `${remSec}s`;
    if (reasonEl) reasonEl.textContent = `Motivo da convocação: ${trib.reason}`;
    if (cluesEl) {
      cluesEl.textContent =
        trib.suspectClues.length > 0
          ? `Avistados próximos nos últimos 15s: ${trib.suspectClues.join(', ')}`
          : 'Nenhum rastro recente detectado perto do local.';
    }
    if (votesStatus) {
      votesStatus.textContent = `Votos secretos computados: ${trib.turn1VotesCount}`;
    }

    const turn1Container = document.getElementById('tribunal-turn1-container');
    const finalistsContainer = document.getElementById('tribunal-finalists-container');
    const verdictActions = document.getElementById('tribunal-verdict-actions');

    const renderKey = `${trib.turn}_${trib.finalists?.join('_') || ''}`;
    const shouldRebuildCards = renderKey !== this.lastTribunalTurnRendered;
    this.lastTribunalTurnRendered = renderKey;

    if (trib.turn === 'TURN_1_SECRET_VOTE') {
      if (turnBadge) turnBadge.textContent = 'TURNO 1: VOTO SECRETO (45s)';
      turn1Container?.classList.remove('hidden');
      finalistsContainer?.classList.add('hidden');
      if (shouldRebuildCards) this.renderTurn1Suspects(snap);
    } else {
      turn1Container?.classList.add('hidden');
      finalistsContainer?.classList.remove('hidden');
      if (shouldRebuildCards) this.renderFinalists(snap);

      if (trib.turn === 'TURN_2_DEFENSE') {
        if (turnBadge) turnBadge.textContent = 'TURNO 2: DEFESA NO ALTAR (20s)';
        verdictActions?.classList.add('hidden');
      } else {
        if (turnBadge) turnBadge.textContent = 'TURNO 3: VEREDITO FINAL (15s)';
        verdictActions?.classList.remove('hidden');
      }
    }
  }

  private renderTurn1Suspects(snap: WorldSnapshot) {
    const grid = document.getElementById('tribunal-suspects-grid');
    if (!grid) return;

    const alivePlayers = snap.players.filter((p) => p.isAlive);
    grid.innerHTML = alivePlayers
      .map((p) => {
        const cls = CLASSES_BY_ID[p.classId];
        const isVoted = this.selectedTurn1Suspect === p.id;
        const portrait = this.getCharacterPortraitDataUrl(p.classId);
        return `
          <div class="suspect-card ${isVoted ? 'voted' : ''}">
            <div class="suspect-info">
              ${portrait ? `<img src="${portrait}" class="avatar-thumb" alt="${cls.name}" />` : ''}
              <div style="min-width: 0;">
                <strong>${p.name}</strong>
                <div class="class-meta-line">${cls.name}</div>
              </div>
            </div>
            <button class="btn-secondary btn-sm" data-vote-id="${p.id}">
              ${isVoted ? 'Votado' : 'Votar'}
            </button>
          </div>
        `;
      })
      .join('');

    grid.querySelectorAll<HTMLButtonElement>('button[data-vote-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-vote-id');
        if (targetId) {
          this.selectedTurn1Suspect = targetId;
          this.socket.emit('tribunal_vote', targetId);
          this.renderTurn1Suspects(snap);
        }
      });
    });
  }

  private renderFinalists(snap: WorldSnapshot) {
    const container = document.getElementById('tribunal-finalists-cards');
    if (!container || !snap.tribunal?.finalists) return;

    const [idA, idB] = snap.tribunal.finalists;
    const playerA = snap.players.find((p) => p.id === idA);
    const playerB = snap.players.find((p) => p.id === idB);

    container.innerHTML = `
      <div class="finalist-box">
        <span class="modal-eyebrow">ACUSADO A NO ALTAR</span>
        <h3>${playerA?.name || 'Suspeito A'}</h3>
        <p class="class-meta-line">Classe declarada: ${
          playerA ? CLASSES_BY_ID[playerA.classId].name : '-'
        }</p>
        <p class="class-meta-line">"Eu estava cumprindo minha missão longe do crime! Não atirem em um inocente!"</p>
      </div>
      <div class="finalist-box">
        <span class="modal-eyebrow">ACUSADO B NO ALTAR</span>
        <h3>${playerB?.name || 'Suspeito B'}</h3>
        <p class="class-meta-line">Classe declarada: ${
          playerB ? CLASSES_BY_ID[playerB.classId].name : '-'
        }</p>
        <p class="class-meta-line">"Verifiquem o relatório de pistas! Eu não passei perto do corpo nos últimos 15s!"</p>
      </div>
    `;
  }

  public renderClassesCatalog() {
    const grid = document.getElementById('classes-catalog-grid');
    if (!grid) return;

    const takenByOther = new Map<ClassId, string>();
    if (this.latestSnapshot) {
      for (const p of this.latestSnapshot.players) {
        if (p.id !== this.socket.id) {
          takenByOther.set(p.classId, p.name);
        }
      }
    }

    const me = this.latestSnapshot?.players.find((p) => p.id === this.socket.id);

    grid.innerHTML = CLASSES_LIST.map((cls) => {
      const holderName = !cls.unlimitedInRoom ? takenByOther.get(cls.id) : undefined;
      const isMyClass = me?.classId === cls.id;
      const portraitUrl = this.getCharacterPortraitDataUrl(cls.id);

      return `
        <div class="class-item-card">
          <div class="class-card-top">
            ${
              portraitUrl
                ? `<img src="${portraitUrl}" class="class-portrait" alt="${cls.name}" />`
                : ''
            }
            <div style="flex: 1; min-width: 0;">
              <div class="class-item-header">
                <h4>${cls.order}. ${cls.name}</h4>
                <span class="class-xp-req">Nv.${cls.requiredLevel} (${cls.requiredXp.toLocaleString('pt-BR')} XP)</span>
              </div>
              <div class="class-meta-line"><strong>Missão:</strong> ${cls.missionTitle}</div>
              <div class="class-meta-line"><strong>${cls.abilityName}:</strong> ${cls.abilityDescription}</div>
            </div>
          </div>
          <button
            class="${isMyClass ? 'btn-primary' : 'btn-secondary'}"
            data-select-class="${cls.id}"
            ${holderName ? 'disabled' : ''}
          >
            ${
              isMyClass
                ? 'Classe Equipada'
                : holderName
                  ? `Travada por ${holderName}`
                  : cls.unlimitedInRoom
                    ? 'Selecionar (Ilimitado)'
                    : 'Selecionar (1 Vaga na Sala)'
            }
          </button>
        </div>
      `;
    }).join('');

    grid.querySelectorAll<HTMLButtonElement>('button[data-select-class]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cid = btn.getAttribute('data-select-class') as ClassId;
        this.socket.emit('select_class', cid, (res: { ok: boolean; reason?: string }) => {
          if (!res.ok && res.reason) {
            this.showToast(res.reason);
          } else {
            this.showToast(`Classe alterada para ${CLASSES_BY_ID[cid].name}!`);
            this.renderClassesCatalog();
          }
        });
      });
    });
  }

  public openVictoryWheelModal(winner: 'VILLAGE' | 'WEREWOLF', reason: string) {
    const modal = document.getElementById('modal-victory-wheel');
    if (!modal) return;
    modal.classList.remove('hidden');

    const eyebrow = document.getElementById('postgame-winner-eyebrow');
    const reasonEl = document.getElementById('postgame-reason');
    const resultBanner = document.getElementById('wheel-result-banner');
    const spinBtn = document.getElementById('btn-spin-stop') as HTMLButtonElement | null;

    if (eyebrow) {
      eyebrow.textContent =
        winner === 'VILLAGE' ? 'VITÓRIA DO VILAREJO!' : 'VITÓRIA DO LOBISOMEM!';
    }
    if (reasonEl) reasonEl.textContent = reason;
    if (resultBanner) {
      resultBanner.textContent =
        'Toque em "Parar Ponteiro (Skill Check)" quando o indicador atingir a Zona Dourada no topo!';
    }
    if (spinBtn) {
      spinBtn.disabled = false;
      spinBtn.textContent = 'Parar Ponteiro (Skill Check)!';
    }

    this.wheelAngleDeg = Math.random() * 360;
    this.wheelSpinning = true;
    this.startWheelLoop();
  }

  private startWheelLoop() {
    this.stopWheelLoop();
    const step = () => {
      if (this.wheelSpinning) {
        this.wheelAngleDeg = (this.wheelAngleDeg + 5.8) % 360;
      }
      this.drawVictoryWheelCanvas();
      this.wheelAnimId = requestAnimationFrame(step);
    };
    this.wheelAnimId = requestAnimationFrame(step);
  }

  private stopWheelLoop() {
    if (this.wheelAnimId !== null) {
      cancelAnimationFrame(this.wheelAnimId);
      this.wheelAnimId = null;
    }
  }

  private handleSkillCheckTrigger() {
    if (!this.wheelSpinning) {
      this.wheelSpinning = true;
      const spinBtn = document.getElementById('btn-spin-stop');
      if (spinBtn) spinBtn.textContent = 'Parar Ponteiro (Skill Check)!';
      return;
    }

    this.wheelSpinning = false;
    this.socket.emit('spin_victory_wheel', this.wheelAngleDeg, (res: any) => {
      const resultBanner = document.getElementById('wheel-result-banner');
      const spinBtn = document.getElementById('btn-spin-stop');
      if (resultBanner && res) {
        resultBanner.textContent = `${res.label} — Total da Conta: ${res.newTotalXp.toLocaleString('pt-BR')} XP`;
      }
      if (spinBtn) {
        spinBtn.textContent = 'Girar Novamente (Treinar Skill Check)';
      }
    });
  }

  private drawVictoryWheelCanvas() {
    const canvas = document.getElementById('victory-wheel-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 122;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Base da Roleta em Madeira de Carvalho Escura & Bronze Antigo
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#1a120b';
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#7c5836';
    ctx.stroke();

    const topRad = -Math.PI / 2;

    // Zona Boa (25% - Verde Floresta / Musgo)
    const goodHalfRad = (54 * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, topRad - goodHalfRad, topRad + goodHalfRad);
    ctx.closePath();
    ctx.fillStyle = 'rgba(45, 106, 79, 0.55)';
    ctx.fill();

    // Zona Dourada (5% - Âmbar / Ouro Antigo)
    const goldHalfRad = (9 * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, topRad - goldHalfRad, topRad + goldHalfRad);
    ctx.closePath();
    ctx.fillStyle = '#d99b26';
    ctx.fill();

    for (let i = 0; i < 19; i++) {
      const a = (i / 19) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40);
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.strokeStyle = 'rgba(181, 158, 132, 0.22)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    const pointerRad = topRad + (this.wheelAngleDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(pointerRad) * (radius - 8),
      cy + Math.sin(pointerRad) * (radius - 8)
    );
    ctx.strokeStyle = '#f2e8d5';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fillStyle = '#0b0806';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#7c5836';
    ctx.stroke();
  }
}
