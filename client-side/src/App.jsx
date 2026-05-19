/**
 * Purpose:
 * - Main gameplay container orchestrating input, simulation loops, network writes, and rendering.
 *
 * Responsibilities:
 * - Manage local player state and interaction handlers.
 * - Coordinate host-only world simulation tasks (food + bots).
 * - Render world + entities to canvas and drive UI overlays.
 *
 * Key concepts:
 * - Local gameplay is immediate; remote state flows through `useGameSync`.
 * - Host ownership controls authoritative bot and food simulation.
 * - Render loop and network sender loop are intentionally decoupled.
 */
import React, { useEffect, useRef, useState } from 'react';
// Firebase Realtime Database (modular v9)
// NOTE: we intentionally use child-based listeners to avoid reloading whole trees.
import {
  ref as dbRef,
  push as dbPush,
  set as dbSet,
  update as dbUpdate,
  get as dbGet,
  remove as dbRemove,
  onDisconnect,
  onValue,
  runTransaction,
  serverTimestamp,
} from 'firebase/database';
import { db } from './firebase/config';
import { incrementDbWrites } from './firebase/writeMeter';
import { spawnFood } from './simulators/Spawn';
import { ensureBots, updateBotsTowardFood } from './simulators/Bot';
import {
  WORLD_SIZE,
  TICK_RATE,
  getAttackDelayByLevel,
  VIEW_MARGIN,
  SPEED,
  SPEED_BOOST_MULTIPLIER,
  BOOST_SCORE_DRAIN_PER_SEC,
  SWING_EXTEND_DURATION,
  SWING_RETURN_DURATION,
  SWING_TOTAL_DURATION,
  KNOCKBACK_Y,
  RESPAWN_DELAY_MS,
  RESPAWN_INVULNERABLE_MS,
  BOT_UPDATE_INTERVAL_MS,
  BOT_ENSURE_INTERVAL_MS,
  FOOD_SPAWN_INTERVAL_MS,
  DEFAULT_ROOM_ID,
  BOT_ID_PREFIX,
} from './constants/gameConfig';
import {
  getLevelFromScore,
  getScoreFloorForLevel,
  getSizeFromLevel,
  getSwordWorldPoints,
  checkCollision,
} from './utils/physics';
import { getAngle, getPointToSegmentDistance, normalizeAngle } from './utils/math';
import { drawPlayer, drawAttackCooldownUnderLabel } from './renderer/playerRenderer';
import { drawGrid, drawFood } from './renderer/worldRenderer';
import { useGameSync } from './hooks/useGameSync';
import { buildHudState } from './utils/hudState';
import { buildCombatHitPatches, buildKillScoreDelta } from './utils/combat';
import { consumeFoodTransaction, getFoodScoreValue } from './utils/foodConsumption';
import GameHud from './components/GameHud';
import RoomChatBox from './components/RoomChatBox';
import ChatInputOverlay from './components/ChatInputOverlay';
import MainMenu from './components/MainMenu';
import DeathOverlay from './components/DeathOverlay';
import { getRoomCollectionPath } from './firebase/paths';
import EmoteWheel from './components/EmoteWheel';
import { EMOTE_OPTIONS, EMOTE_DURATION_MS, getEmoteById } from './constants/emotes';
import { drawEmoteBubble } from './renderer/playerRenderer';
import { HOST_HEARTBEAT_INTERVAL_MS, HOST_EXPIRY_MS, HOST_CHECK_INTERVAL_MS } from './constants/host';

const KILL_EXP_TEXT_DURATION_MS = 1400;
const KILL_EXP_TEXT_FONT_SIZE = 22;
// Host timing constants are in constants/host.js

const drawKillExpNotifications = (ctx, notifications, camX, camY, now) => {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${KILL_EXP_TEXT_FONT_SIZE}px Arial`;
  ctx.lineJoin = 'round';

  notifications.forEach((notice) => {
    const age = now - notice.createdAt;
    const progress = Math.max(0, Math.min(1, age / KILL_EXP_TEXT_DURATION_MS));
    const sx = notice.x + camX;
    const sy = notice.y + camY - progress * 34;
    const alpha = progress < 0.7 ? 1 : Math.max(0, 1 - (progress - 0.7) / 0.3);
    const text = `+${notice.expGain} EXP`;

    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, sx, sy);
    ctx.fillStyle = '#facc15';
    ctx.fillText(text, sx, sy);
  });

  ctx.restore();
  ctx.globalAlpha = 1;
};

function App() {
  const canvasRef = useRef(null);
  const chatInputRef = useRef(null);
  const [renderTrigger, setRenderTrigger] = useState(0);
  const [isChatInputOpen, setIsChatInputOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [isEmoteWheelOpen, setIsEmoteWheelOpen] = useState(false);
  const [emoteWheelCenter, setEmoteWheelCenter] = useState(null);
  const [emoteHoveredIndex, setEmoteHoveredIndex] = useState(-1);
  const [gameState, setGameState] = useState('menu');
  const [playerName, setPlayerName] = useState('');
  const [killerName, setKillerName] = useState(null);
  const [menuMode, setMenuMode] = useState('menu');
  const roomId = DEFAULT_ROOM_ID;

  // Refs quản lý logic (không gây re-render)
  const myWorldPos = useRef({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });
  const mousePos = useRef({ x: 0, y: 0 });
  const moveAngle = useRef(0);
  const idRef = useRef(crypto.randomUUID());
  const colorRef = useRef(`hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`);

  // Animation vung kiếm
  const swingStart = useRef(0);
  const swingProgress = useRef(0);
  const lastSwingTime = useRef(0);
  const lastSwingHit = useRef({});
  const lastBotSwingHit = useRef({});

  const lastTime = useRef(0);
  const lastSent = useRef(0);
  const lastMoveSentAt = useRef(0);
  const moveSeq = useRef(0);
  const lastBotUpdate = useRef(0);
  const botUpdateInFlight = useRef(false);
  const lastEnsureBots = useRef(0);
  const lastFoodSpawn = useRef(0);
  const lastSentState = useRef(null);
  const myScore = useRef(0);
  const lastLocalScoreMutationAt = useRef(0);
  const pendingFoodConsume = useRef(new Set());
  const wasDeadLastSync = useRef(false);
  const shiftPressed = useRef(false);
  const boostActive = useRef(false);
  const boostScoreAccumulator = useRef(0);
  const isHost = useRef(false); // chỉ host mới chạy bot AI + spawn food
  const heartbeatIntervalRef = useRef(null);
  const hostCheckIntervalRef = useRef(null);
  const combatIntervalRef = useRef(null);
  const hostIdUnsubscribeRef = useRef(null);
  const lastUiRefresh = useRef(0);
  const chatInputOpenRef = useRef(false);
  const chatDraftRef = useRef('');
  const mouseScreenPos = useRef({ x: 0, y: 0 });
  const emoteWheelOpenRef = useRef(false);
  const emoteWheelHoveredRef = useRef(-1);
  const emoteWheelCenterRef = useRef(null);
  const activeEmoteRef = useRef(null);
  const activeEmoteUntilRef = useRef(0);
  const gameStateRef = useRef('menu');
  const playerNameRef = useRef('');
  const respawnPendingRef = useRef(false);
  const killExpNotifications = useRef([]);
  const notifiedKillDeaths = useRef(new Set());
  const lastAliveClientState = useRef({});

  const { smoothClients, foodItems, chatMessages, rawClients, rawFoodItems } = useGameSync(roomId, idRef.current);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    // Run render loop while playing OR while dead so the world remains visible
    // behind overlays (DeathOverlay). Skip when in menu.
    if (gameState === 'menu') return undefined;

    const deathWatcher = window.setInterval(() => {
      const localRawState = rawClients.current[idRef.current];
      if (!localRawState) return;
      if (localRawState.isDead !== true) {
        respawnPendingRef.current = false;
        return;
      }
      if (respawnPendingRef.current) return;

      const killerId = localRawState.killerId || null;
      const killerRawState = killerId ? rawClients.current[killerId] : null;
      const nextKillerName = killerRawState?.name
        || (killerId && killerId.startsWith(BOT_ID_PREFIX) ? 'Bot' : null)
        || (killerId ? killerId.slice(0, 4).toUpperCase() : 'Unknown');

      setKillerName(nextKillerName);
      gameStateRef.current = 'dead';
      setGameState('dead');
      setIsChatInputOpen(false);
      setIsEmoteWheelOpen(false);
    }, 100);

    return () => {
      window.clearInterval(deathWatcher);
    };
  }, [gameState, rawClients]);

  // Keep chat input focus behavior deterministic across open/close cycles.
  useEffect(() => {
    chatInputOpenRef.current = isChatInputOpen;
    if (isChatInputOpen && chatInputRef.current) {
      chatInputRef.current.focus();
      chatInputRef.current.setSelectionRange(chatDraft.length, chatDraft.length);
    }
  }, [isChatInputOpen, chatDraft.length]);

  // Mirror chat draft into ref so keyboard handler always reads latest value.
  useEffect(() => {
    chatDraftRef.current = chatDraft;
  }, [chatDraft]);

  useEffect(() => {
    if (gameState === 'menu') return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ctx = canvas.getContext('2d');
    let raf = 0;

    /** Inputs: none. Output: resizes canvas to viewport bounds. */
    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    /**
     * Input: selected emote id.
     * Output: none (writes emote state to room client node).
     */
    const publishEmote = (emoteId) => {
      if (!emoteId) return;
      const now = Date.now();
      activeEmoteRef.current = emoteId;
      activeEmoteUntilRef.current = now + EMOTE_DURATION_MS;
      // count this outgoing update
      incrementDbWrites(1);
      dbUpdate(dbRef(db, `${getRoomCollectionPath(roomId, 'clients')}/${idRef.current}`), {
        activeEmote: emoteId,
        emoteAt: now,
        emoteUntil: activeEmoteUntilRef.current,
      }).catch((err) => {
        console.error('publish emote error', err);
      });
    };

    /**
     * Inputs: cursor position in screen space.
     * Output: hovered wedge index or -1 when outside valid ring.
     */
    const getHoveredEmoteIndex = (clientX, clientY) => {
      const center = emoteWheelCenterRef.current;
      if (!center) return -1;
      const dx = clientX - center.x;
      const dy = clientY - center.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 28) return -1;
      const angle = Math.atan2(dy, dx);
      const rotated = angle + Math.PI / 2;
      const normalized = (rotated + Math.PI * 2) % (Math.PI * 2);
      const slice = (Math.PI * 2) / EMOTE_OPTIONS.length;
      return Math.floor((normalized + slice / 2) / slice) % EMOTE_OPTIONS.length;
    };

    /** Input: mouse event. Output: updates aim and wheel hover state. */
    const handleMouseMove = (e) => {
      mouseScreenPos.current = { x: e.clientX, y: e.clientY };
      mousePos.current = { x: e.clientX - canvas.width / 2, y: e.clientY - canvas.height / 2 };

      if (emoteWheelOpenRef.current) {
        const hoveredIndexNow = getHoveredEmoteIndex(e.clientX, e.clientY);
        if (hoveredIndexNow !== emoteWheelHoveredRef.current) {
          emoteWheelHoveredRef.current = hoveredIndexNow;
          setEmoteHoveredIndex(hoveredIndexNow);
        }
      }
    };

    /**
     * Input: mouse event.
     * Output: opens emote wheel (RMB) or starts local sword swing (LMB).
     *
     * Critical rule:
     * - Respect cooldown checks here to keep attack timing authoritative.
     */
    const handleMouseDown = (e) => {
      if (e.button === 2) {
        e.preventDefault();
        if (chatInputOpenRef.current) return;
        emoteWheelOpenRef.current = true;
        emoteWheelCenterRef.current = { x: e.clientX, y: e.clientY };
        emoteWheelHoveredRef.current = -1;
        setIsEmoteWheelOpen(true);
        setEmoteWheelCenter({ x: e.clientX, y: e.clientY });
        setEmoteHoveredIndex(-1);
        return;
      }

      if (e.button !== 0) return;
      if (emoteWheelOpenRef.current) return;

      const now = Date.now();
      const mySyncState = rawClients.current[idRef.current] || smoothClients.current[idRef.current];
      if (mySyncState?.isDead === true) return;
      if (typeof mySyncState?.invulnerableUntil === 'number' && mySyncState.invulnerableUntil > now) return;
      const myLevelNow = getLevelFromScore(myScore.current);
      const swingCooldownNow = getAttackDelayByLevel(myLevelNow);
      if ((swingStart.current && now - swingStart.current < SWING_TOTAL_DURATION) || (now - lastSwingTime.current < swingCooldownNow)) return;
      swingStart.current = now;
      lastSwingTime.current = now;
    };

    /** Input: mouse event. Output: commits hovered emote on RMB release. */
    const handleMouseUp = (e) => {
      if (e.button === 2 && emoteWheelOpenRef.current) {
        const selectedIndex = emoteWheelHoveredRef.current;
        if (selectedIndex >= 0) {
          publishEmote(EMOTE_OPTIONS[selectedIndex].id);
        }
        emoteWheelOpenRef.current = false;
        emoteWheelCenterRef.current = null;
        emoteWheelHoveredRef.current = -1;
        setIsEmoteWheelOpen(false);
        setEmoteWheelCenter(null);
        setEmoteHoveredIndex(-1);
      }
    };

    /** Input: context menu event. Output: prevent browser menu during gameplay. */
    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    /**
     * Input: keyboard event.
     * Output: handles chat toggle/send, modal escapes, and boost key state.
     */
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && !e.repeat) {
        e.preventDefault();

        if (!chatInputOpenRef.current) {
          setIsChatInputOpen(true);
          return;
        }

        const trimmed = chatDraftRef.current.trim();
        if (!trimmed) return;

        const senderName =
          playerNameRef.current ||
          smoothClients.current?.[idRef.current]?.name ||
          idRef.current.slice(0, 4).toUpperCase();
        const chatRef = dbRef(db, getRoomCollectionPath(roomId, 'chat'));
        const messageRef = dbPush(chatRef);
        // count chat send
        incrementDbWrites(1);
        dbSet(messageRef, {
          text: trimmed,
          senderId: idRef.current,
          senderName,
          ts: Date.now(),
        }).catch((err) => console.error('send chat error', err));

        setChatDraft('');
        setIsChatInputOpen(false);
        return;
      }

      if (e.key === 'Escape' && chatInputOpenRef.current) {
        e.preventDefault();
        setIsChatInputOpen(false);
        return;
      }

      if (e.key === 'Escape' && emoteWheelOpenRef.current) {
        e.preventDefault();
        emoteWheelOpenRef.current = false;
        emoteWheelCenterRef.current = null;
        emoteWheelHoveredRef.current = -1;
        setIsEmoteWheelOpen(false);
        setEmoteWheelCenter(null);
        setEmoteHoveredIndex(-1);
        return;
      }

      if (chatInputOpenRef.current || emoteWheelOpenRef.current) return;

      if (e.key === 'Shift') {
        shiftPressed.current = true;
      }
    };

    /** Input: keyboard event. Output: releases boost key state. */
    const handleKeyUp = (e) => {
      if (e.key === 'Shift') {
        shiftPressed.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('contextmenu', handleContextMenu);

    // Firebase
    const clientsPath = getRoomCollectionPath(roomId, 'clients');
    const userRef = dbRef(db, `${clientsPath}/${idRef.current}`);
    const hostRef = dbRef(db, getRoomCollectionPath(roomId, 'host'));
    const clientsRootRef = dbRef(db, clientsPath);

    /**
     * Input: signed score delta from local-only actions.
     * Output: transactionally updates the authoritative score field.
     *
     * WHY: regular movement heartbeats must not carry stale score values that
     * can overwrite host-awarded kill EXP before this client receives it.
     */
    const commitLocalScoreDelta = async (delta) => {
      if (!Number.isFinite(delta) || delta === 0) return;

      try {
        // count score transaction attempt
        incrementDbWrites(1);
        const result = await runTransaction(userRef, (current) => {
          if (current === null) return current;
          const currentScore = Number.isFinite(current.score) ? current.score : 0;
          const currentUpdatedAt = Number.isFinite(current.updatedAt) ? current.updatedAt : 0;
          return {
            ...current,
            score: Math.max(0, currentScore + delta),
            updatedAt: Math.max(currentUpdatedAt, Date.now()),
          };
        });

        const committedValue = result.snapshot?.val();
        const committedScore = committedValue?.score;
        const committedUpdatedAt = committedValue?.updatedAt;
        if (result.committed && Number.isFinite(committedScore)) {
          myScore.current = committedScore;
          lastLocalScoreMutationAt.current = Number.isFinite(committedUpdatedAt)
            ? committedUpdatedAt
            : Date.now();
        }
      } catch (err) {
        console.error('score transaction error', err);
      }
    };

    // Xoá client của mình khi disconnect để tránh rác dữ liệu
    onDisconnect(userRef).remove();

    /**
     * Input: none.
     * Output: none (may claim host role in DB if missing/stale).
     *
     * Critical rule:
     * - Host election heartbeat must stay resilient; bot/food simulation depends on it.
     */
    const clearOwnedHost = async () => {
      isHost.current = false;
      try {
        // count host clear transaction attempt
        incrementDbWrites(1);
        await runTransaction(hostRef, (current) => {
          if (!current || current.id !== idRef.current) return current;
          return null;
        });
      } catch (err) {
        console.error('clearOwnedHost error', err);
      }
    };

    // Host election/heartbeat is managed by tryClaimHost/startHostIntervals logic below

    // Interval refs are declared at top-level (near other refs)

    const startHostIntervals = async () => {
      if (isHost.current) return;
      isHost.current = true;

      // Immediately write a heartbeat with server timestamp and register onDisconnect cleanup
      try {
        // count initial host claim update
        incrementDbWrites(1);
        await dbUpdate(hostRef, { id: idRef.current, ts: serverTimestamp() });
        await onDisconnect(hostRef).remove();
      } catch (err) {
        // onDisconnect may fail in some environments; continue regardless
        console.error('startHostIntervals onDisconnect/register error', err);
      }

      // Heartbeat: update host.ts periodically using server timestamp
      heartbeatIntervalRef.current = setInterval(() => {
        if (!isHost.current) return;
        // count heartbeat write
        incrementDbWrites(1);
        dbUpdate(hostRef, { id: idRef.current, ts: serverTimestamp() }).catch((err) => {
          console.error('host heartbeat error', err);
        });
      }, HOST_HEARTBEAT_INTERVAL_MS);

      // Combat loop: only active on host
      combatIntervalRef.current = setInterval(() => {
        if (!isHost.current) return;
        const now = Date.now();
        const combatPatches = buildCombatHitPatches(rawClients.current, now);
        const writeEntries = Object.entries(combatPatches);
        // count per-entity combat writes
        if (writeEntries.length) incrementDbWrites(writeEntries.length);
        Promise.all([
          ...writeEntries.map(([id, patch]) => dbUpdate(dbRef(db, `${clientsPath}/${id}`), patch)),
          processAuthoritativeRespawns(),
        ]).catch((err) => {
          console.error('authoritative combat loop error', err);
        });
      }, 50);

      // Watch for being replaced as host: if host/id changes to another id, stop intervals
      hostIdUnsubscribeRef.current = onValue(dbRef(db, `${getRoomCollectionPath(roomId, 'host')}/id`), (snapshot) => {
        const currentHostId = snapshot.val();
        if (currentHostId && currentHostId !== idRef.current && isHost.current) {
          // Another client claimed host — relinquish
          stopHostIntervals();
        }
      });
    };

    const stopHostIntervals = async () => {
      // Clear heartbeat + combat intervals
      try {
        if (heartbeatIntervalRef.current) {
          clearInterval(heartbeatIntervalRef.current);
          heartbeatIntervalRef.current = null;
        }
        if (combatIntervalRef.current) {
          clearInterval(combatIntervalRef.current);
          combatIntervalRef.current = null;
        }

        // Cancel any onDisconnect removal to avoid races
        await onDisconnect(hostRef).cancel().catch(() => {});

        if (hostIdUnsubscribeRef.current) {
          hostIdUnsubscribeRef.current();
          hostIdUnsubscribeRef.current = null;
        }
      } catch (err) {
        console.error('stopHostIntervals error', err);
      } finally {
        isHost.current = false;
      }
    };

    // Try to claim host using a transaction that checks expiry
    const tryClaimHost = async () => {
      if (document.visibilityState !== 'visible') return false;

      try {
        const now = Date.now();
        // count host claim transaction attempt
        incrementDbWrites(1);
        const result = await runTransaction(hostRef, (current) => {
          const isExpired = !current?.ts || (now - current.ts) > HOST_EXPIRY_MS;
          const isAbandoned = !current?.id;
          if (isExpired || isAbandoned) {
            return { id: idRef.current, ts: serverTimestamp() };
          }
          return; // abort
        });

        const committedHost = result.snapshot?.val();
        const claimed = result.committed && committedHost?.id === idRef.current;
        if (claimed) {
          // Start host-only loops
          await startHostIntervals();
        }
        return claimed;
      } catch (err) {
        console.error('tryClaimHost error', err);
        return false;
      }
    };

    // Initial attempt to claim host on mount
    tryClaimHost();

    // Periodically check host liveness and try to claim if expired
    hostCheckIntervalRef.current = setInterval(async () => {
      if (isHost.current) return;
      if (document.visibilityState !== 'visible') return;

      try {
        const snap = await dbGet(hostRef);
        const hostData = snap.val();
        const isDead = !hostData?.ts || (Date.now() - hostData.ts) > HOST_EXPIRY_MS;
        if (isDead) {
          const claimed = await tryClaimHost();
          if (claimed) {
            // startHostIntervals already called inside tryClaimHost
          }
        }
      } catch (err) {
        console.error('host liveness check error', err);
      }
    }, HOST_CHECK_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tryClaimHost();
      } else if (isHost.current) {
        // Give up host immediately when tab hidden to avoid split-brain on background tabs
        stopHostIntervals();
        // Also try to clear host record in db if we own it
        // count host clear transaction attempt from visibility change
        incrementDbWrites(1);
        runTransaction(hostRef, (current) => {
          if (!current || current.id !== idRef.current) return current;
          return null;
        }).catch(() => {});
      }
    };

    // Performance-sensitive sender loop: keep network updates independent from render throttling.
    const networkPoll = setInterval(() => {
      const now = Date.now();
      const mySyncState = rawClients.current[idRef.current] || smoothClients.current[idRef.current];
      const isDeadFromServer = mySyncState?.isDead === true;
      const isInvulnerableFromServer = typeof mySyncState?.invulnerableUntil === 'number' && mySyncState.invulnerableUntil > now;
      const myServerScore = typeof mySyncState?.score === 'number' ? mySyncState.score : null;
      const myServerUpdatedAt = typeof mySyncState?.updatedAt === 'number' ? mySyncState.updatedAt : 0;
      if (Number.isFinite(myServerScore)) {
        const recoveredFromDeath = !isDeadFromServer && wasDeadLastSync.current;
        const serverGainedScore = myServerScore > myScore.current;
        const serverScoreIsNewerThanLocal = myServerUpdatedAt > lastLocalScoreMutationAt.current;
        if (isDeadFromServer || recoveredFromDeath || (serverGainedScore && serverScoreIsNewerThanLocal)) {
          myScore.current = myServerScore;
          lastLocalScoreMutationAt.current = myServerUpdatedAt || now;
        }
      }
      wasDeadLastSync.current = isDeadFromServer;

      const isPositionLocked = isDeadFromServer;
      const isAttackLocked = isDeadFromServer || isInvulnerableFromServer;
      const sendX = isPositionLocked && typeof mySyncState?.x === 'number' ? mySyncState.x : myWorldPos.current.x;
      const sendY = isPositionLocked && typeof mySyncState?.y === 'number' ? mySyncState.y : myWorldPos.current.y;
      const sendSwing = isAttackLocked ? 0 : swingProgress.current;
      const angle = Math.atan2(mousePos.current.y, mousePos.current.x);
      const payload = {
        x: sendX,
        y: sendY,
        color: colorRef.current,
        angle,
        swordAngle: moveAngle.current,
        swordSwing: sendSwing,
        lastSwingTime: lastSwingTime.current,
        name: playerNameRef.current || idRef.current.slice(0, 4).toUpperCase(),
        boost: boostActive.current,
        lastSeen: now,
        updatedAt: now,
        activeEmote: activeEmoteRef.current,
        emoteAt: activeEmoteRef.current ? Math.max(0, activeEmoteUntilRef.current - EMOTE_DURATION_MS) : 0,
        emoteUntil: activeEmoteRef.current ? activeEmoteUntilRef.current : 0,
        moveSeq: moveSeq.current,
        moveSentAt: lastMoveSentAt.current,
      };

      const prev = lastSentState.current;
      const dxNet = !prev ? Infinity : payload.x - prev.x;
      const dyNet = !prev ? Infinity : payload.y - prev.y;
      const movedFarEnough = !prev || Math.hypot(dxNet, dyNet) > 2;
      const angleChanged = !prev || Math.abs(normalizeAngle((payload.angle || 0) - (prev.angle || 0))) > 0.05;
      const swordAngleChanged = !prev || Math.abs(normalizeAngle((payload.swordAngle || 0) - (prev.swordAngle || 0))) > 0.06;
      const swingChanged = !prev || Math.abs((payload.swordSwing || 0) - (prev.swordSwing || 0)) > 0.04;
      const boostChanged = !prev || prev.boost !== payload.boost;
      const emoteChanged = !prev || prev.activeEmote !== payload.activeEmote || prev.emoteUntil !== payload.emoteUntil;
      const heartbeatDue = !prev || now - lastSent.current > 700;

      if (movedFarEnough || angleChanged || swordAngleChanged || swingChanged || boostChanged || emoteChanged || heartbeatDue) {
        lastSent.current = now;
        if (movedFarEnough) {
          moveSeq.current += 1;
          lastMoveSentAt.current = now;
          payload.moveSeq = moveSeq.current;
          payload.moveSentAt = lastMoveSentAt.current;
        }
        lastSentState.current = payload;
        // count network heartbeat/update
        incrementDbWrites(1);
        dbUpdate(userRef, payload).catch((err) => {
          console.error('network sync error', err);
        });
      }
    }, 50);

    /**
     * Host-authoritative respawn processor.
     * WHY: respawn position/invulnerability must come from server state.
     */
    const processAuthoritativeRespawns = async () => {
      if (!isHost.current) return;

      const now = Date.now();
      const snapshot = rawClients.current || {};
      const respawnUpdates = {};

      Object.entries(snapshot).forEach(([id, entity]) => {
        if (!entity || entity.isDead !== true) return;
        if (id.startsWith(BOT_ID_PREFIX)) return;

        const deathAt = typeof entity.deathAt === 'number' ? entity.deathAt : 0;
        const respawnRequestedAt = typeof entity.respawnRequestedAt === 'number' ? entity.respawnRequestedAt : 0;
        if (!respawnRequestedAt) return;
        if (!deathAt || now - deathAt < RESPAWN_DELAY_MS) return;

        respawnUpdates[id] = {
          x: Math.random() * WORLD_SIZE,
          y: Math.random() * WORLD_SIZE,
          isDead: false,
          killerId: null,
          killExpGain: 0,
          invulnerableUntil: now + RESPAWN_INVULNERABLE_MS,
          deathAt: 0,
          updatedAt: now,
          respawnRequestedAt: 0,
          score: typeof entity.score === 'number' ? entity.score : 0,
          swordSwing: 0,
          leftPunch: 0,
          rightPunch: 0,
          lastSwingTime: 0,
          lastSwingHit: null,
          lastPunchHit: null,
          punchStart: 0,
          boost: false,
        };
      });

      const entries = Object.entries(respawnUpdates);
      if (!entries.length) return;

      // count respawn writes
      if (entries.length) incrementDbWrites(entries.length);
      await Promise.all(
        entries.map(([id, patch]) =>
          dbUpdate(dbRef(db, `${clientsPath}/${id}`), patch),
        ),
      );
    };

    // Keep combat resolution off render loop; host applies authoritative kill updates.
    // Combat loop is started/stopped by host control (startHostIntervals/stopHostIntervals).

    /** Input: entity + timestamp. Output: whether entity is currently invulnerable. */
    const isEntityInvulnerable = (entity, currentNow) => {
      if (!entity) return false;
      const invulnerableUntil = typeof entity.invulnerableUntil === 'number' ? entity.invulnerableUntil : 0;
      return invulnerableUntil > currentNow;
    };

    /**
     * Input: RAF timestamp.
     * Output: none (advances local simulation and renders current frame).
     *
     * Critical rules:
     * - Host-only block must remain host-gated.
     * - Rendering and hit checks rely on same geometry helpers used by simulation.
     */
    const gameLoop = (ts) => {
      // --- HOST-ONLY LOGIC: bot AI + food spawn ---
      if (isHost.current) {
        if (!lastFoodSpawn.current || ts - lastFoodSpawn.current > FOOD_SPAWN_INTERVAL_MS) {
          lastFoodSpawn.current = ts;
          spawnFood(roomId).catch((err) => console.error('spawnFood error', err));
        }

        if (!lastEnsureBots.current || ts - lastEnsureBots.current > BOT_ENSURE_INTERVAL_MS) {
          lastEnsureBots.current = ts;
          ensureBots(roomId).catch((err) => {
            console.error('ensureBots error', err);
          });
        }

        // Tick bot: cho bot di chuyển kiếm food gần nhất với tần suất thấp hơn
        if (!botUpdateInFlight.current && (!lastBotUpdate.current || ts - lastBotUpdate.current > BOT_UPDATE_INTERVAL_MS)) {
          lastBotUpdate.current = ts;
          botUpdateInFlight.current = true;
          // Dùng raw snapshot (authoritative) cho simulation; smooth cache chỉ dành cho render.
          updateBotsTowardFood(rawClients.current, rawFoodItems.current, roomId)
            .catch((err) => {
              console.error('updateBotsTowardFood error', err);
            })
            .finally(() => {
              botUpdateInFlight.current = false;
            });
        }
      }
      const dt = (ts - (lastTime.current || ts)) / 1000;
      lastTime.current = ts;

      // Tăng tốc khi giữ Shift: speed x1.5 và trừ điểm dần theo thời gian
      let speedMultiplier = 1;
      if (shiftPressed.current && myScore.current > 0) {
        boostActive.current = true;
      } else {
        boostActive.current = false;
      }

      if (boostActive.current) {
        speedMultiplier = SPEED_BOOST_MULTIPLIER;

        // Tích luỹ số điểm cần trừ theo thời gian để trừ theo đơn vị 1 điểm
        boostScoreAccumulator.current += BOOST_SCORE_DRAIN_PER_SEC * dt;
        const pointsToPay = Math.floor(boostScoreAccumulator.current);
        if (pointsToPay > 0) {
          const actualPay = Math.min(pointsToPay, myScore.current);
          myScore.current -= actualPay;
          lastLocalScoreMutationAt.current = Date.now();
          commitLocalScoreDelta(-actualPay);
          boostScoreAccumulator.current -= actualPay;
          if (myScore.current <= 0) {
            myScore.current = 0;
            lastLocalScoreMutationAt.current = Date.now();
            boostActive.current = false;
          }
        }
      } else {
        // Không tăng tốc thì reset nhẹ accumulator để tránh trừ lẹm khi nhấn lại
        boostScoreAccumulator.current = 0;
      }

      // 1. Logic di chuyển & Animation
      const now = Date.now();
      const myStateNow = rawClients.current[idRef.current] || smoothClients.current[idRef.current];
      const myIsDead = myStateNow?.isDead === true;
      const myIsInvulnerable = isEntityInvulnerable(myStateNow, now);
      if (myIsDead) {
        swingStart.current = 0;
        swingProgress.current = 0;
      }
      const dx = mousePos.current.x, dy = mousePos.current.y;
      const dist = Math.hypot(dx, dy);
      if (!myIsDead && dist > 10) {
        moveAngle.current = getAngle(0, 0, dx, dy);
        const currentSpeed = SPEED * speedMultiplier;
        myWorldPos.current.x = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.x + (dx / dist) * currentSpeed * dt));
        myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.y + (dy / dist) * currentSpeed * dt));
      }

      // Reconcile local Y with authoritative room state so remote knockback is visible on victim client.
      const mySynced = smoothClients.current[idRef.current];
      if (mySynced && typeof mySynced.y === 'number') {
        if (typeof mySynced.x === 'number') {
          const xDeltaFromServer = mySynced.x - myWorldPos.current.x;
          if (Math.abs(xDeltaFromServer) > 40 || mySynced.isDead === true) {
            myWorldPos.current.x = Math.max(0, Math.min(WORLD_SIZE, mySynced.x));
          }
        }
        const yDeltaFromServer = mySynced.y - myWorldPos.current.y;
        if (Math.abs(yDeltaFromServer) > 40 || mySynced.isDead === true) {
          myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, mySynced.y));
        }
      }

      if (activeEmoteRef.current && activeEmoteUntilRef.current <= now) {
        activeEmoteRef.current = null;
        activeEmoteUntilRef.current = 0;
      }
      if (now - lastUiRefresh.current > 250) {
        lastUiRefresh.current = now;
        setRenderTrigger((t) => t + 1);
      }
      if (swingStart.current) {
        const elapsed = now - swingStart.current;
        const t = Math.min(1, elapsed / SWING_TOTAL_DURATION);
        if (elapsed <= SWING_EXTEND_DURATION) {
          // Pha vung ra: 0 -> 1
          swingProgress.current = elapsed / SWING_EXTEND_DURATION;
        } else {
          // Pha rụt về: 1 -> 0
          const returnElapsed = elapsed - SWING_EXTEND_DURATION;
          swingProgress.current = Math.max(0, 1 - returnElapsed / SWING_RETURN_DURATION);
        }

        if (t >= 1) {
          swingStart.current = 0;
          swingProgress.current = 0;
        }
      }

      // 4. VẼ LÊN CANVAS
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const camX = canvas.width / 2 - myWorldPos.current.x;
      const camY = canvas.height / 2 - myWorldPos.current.y;
      const myAngle = getAngle(0, 0, mousePos.current.x, mousePos.current.y);
      const mySwordAngle = moveAngle.current;

      Object.entries(rawClients.current).forEach(([id, client]) => {
        if (!client || id === idRef.current) return;

        if (client.isDead !== true) {
          lastAliveClientState.current[id] = {
            x: typeof client.x === 'number' ? client.x : 0,
            y: typeof client.y === 'number' ? client.y : 0,
            score: typeof client.score === 'number' ? client.score : 0,
          };
          return;
        }

        const deathAt = typeof client.deathAt === 'number' ? client.deathAt : 0;
        if (!deathAt || client.killerId !== idRef.current) return;

        const deathKey = `${id}:${deathAt}`;
        if (notifiedKillDeaths.current.has(deathKey)) return;

        const lastAlive = lastAliveClientState.current[id];
        const fallbackScore = typeof lastAlive?.score === 'number' ? lastAlive.score : client.score;
        const expGain = typeof client.killExpGain === 'number'
          ? client.killExpGain
          : buildKillScoreDelta(fallbackScore).attackerGain;

        killExpNotifications.current.push({
          id,
          deathAt,
          x: typeof client.x === 'number' ? client.x : lastAlive?.x || 0,
          y: typeof client.y === 'number' ? client.y : lastAlive?.y || 0,
          expGain,
          createdAt: now,
        });
        notifiedKillDeaths.current.add(deathKey);
      });

      killExpNotifications.current = killExpNotifications.current.filter(
        (notice) => now - notice.createdAt < KILL_EXP_TEXT_DURATION_MS,
      );

      // --- RENDERING ---
      drawGrid(ctx, camX, camY, canvas.width, canvas.height);

      // Vẽ food (hình tròn nhỏ), kích thước theo size trong database
      // Đồng thời xử lý va chạm giữa player và food (ăn food)
      const myLevel = getLevelFromScore(myScore.current);
      const mySize = getSizeFromLevel(myLevel);
      const myRadius = mySize / 2;

      drawFood(
        ctx,
        rawFoodItems.current,
        camX,
        camY,
        myWorldPos.current,
        myIsDead ? -1e9 : myRadius,
        async (food, foodId) => {
          if (myIsDead) return;
          if (!foodId || pendingFoodConsume.current.has(foodId)) return;

          pendingFoodConsume.current.add(foodId);
          try {
            const result = await consumeFoodTransaction(db, roomId, foodId);
            if (result.committed) {
              const scoreDelta = getFoodScoreValue(food?.size || 1);
              myScore.current += scoreDelta;
              lastLocalScoreMutationAt.current = Date.now();
              commitLocalScoreDelta(scoreDelta);
            }
          } catch (err) {
            console.error('consumeFood error', err);
          } finally {
            pendingFoodConsume.current.delete(foodId);
          }
        },
      );

      // Vẽ người chơi khác
      Object.entries(smoothClients.current).forEach(([id, p]) => {
        if (id === idRef.current) {
          return;
        }
        if (!smoothClients.current[id]) {
          return;
        }

        const fbClient = smoothClients.current[id];
        const rawClient = rawClients.current[id] || fbClient;
        if (fbClient?.isDead === true) {
          return;
        }
        const enemyScore = typeof fbClient?.score === 'number' ? fbClient.score : 0;
        const enemyLevel = getLevelFromScore(enemyScore);
        const enemySize = getSizeFromLevel(enemyLevel);
        const enemyRadius = enemySize / 2;
        const enemyName = fbClient?.name || id.slice(0, 3).toUpperCase();
        const enemyLabel = `Lv${enemyLevel} ${enemyName}`;

        const ex = p.x + camX;
        const ey = p.y + camY;
        if (
          ex + enemyRadius < -VIEW_MARGIN ||
          ex - enemyRadius > canvas.width + VIEW_MARGIN ||
          ey + enemyRadius < -VIEW_MARGIN ||
          ey - enemyRadius > canvas.height + VIEW_MARGIN
        ) {
          return;
        }

        const enemySwing = typeof p.swordSwing === 'number'
          ? p.swordSwing
          : Math.max(p.leftPunch || 0, p.rightPunch || 0);
        const enemyRawSwing = typeof rawClient?.swordSwing === 'number'
          ? rawClient.swordSwing
          : Math.max(rawClient?.leftPunch || 0, rawClient?.rightPunch || 0);
        const enemySwordAngle =
          typeof p.swordAngle === 'number'
            ? p.swordAngle
            : (typeof p.angle === 'number' ? p.angle : 0);
        const enemyRawSwordAngle =
          typeof rawClient?.swordAngle === 'number'
            ? rawClient.swordAngle
            : (typeof rawClient?.angle === 'number' ? rawClient.angle : enemySwordAngle);
        const enemyRenderAngle = id.startsWith('bot-')
          ? (typeof p.angle === 'number' ? p.angle : enemySwordAngle)
          : enemySwordAngle;

        // Bot đập trúng player local
        if (id.startsWith('bot-')) {
          const botSwingStamp = typeof rawClient?.lastPunchTime === 'number' ? rawClient.lastPunchTime : 0;
          // Combat hits are resolved authoritatively in the host combat poll.
        }

        // Player local chém trúng entity khác
        // Combat hits are resolved authoritatively in the host combat poll.

        drawPlayer(
          ctx,
          ex,
          ey,
          enemyRenderAngle,
          p.color,
          enemySwing,
          0,
          enemyLabel,
          Boolean(fbClient && fbClient.boost),
          enemyLevel,
          rawClient?.invulnerableUntil || 0,
          rawClient?.isDead === true,
        );

        const enemyEmote = fbClient?.activeEmote && typeof fbClient?.emoteUntil === 'number' && fbClient.emoteUntil > now
          ? getEmoteById(fbClient.activeEmote)
          : null;
        if (enemyEmote) {
          drawEmoteBubble(ctx, ex, ey, enemyEmote.icon, enemyLevel, 1.6);
        }
      });

      if (!myIsDead) {
        // Vẽ bản thân (size theo level)
        const selfLabel = `Lv${myLevel} YOU`;
        drawPlayer(
          ctx,
          canvas.width / 2,
          canvas.height / 2,
          mySwordAngle,
          colorRef.current,
          swingProgress.current,
          0,
          selfLabel,
          boostActive.current,
          myLevel,
          rawClients.current[idRef.current]?.invulnerableUntil || 0,
          rawClients.current[idRef.current]?.isDead === true,
        );

        const attackCooldownMs = getAttackDelayByLevel(myLevel);
        const attackCooldownRemaining = Math.max(0, attackCooldownMs - (Date.now() - lastSwingTime.current));
        const attackCooldownProgress = attackCooldownMs > 0 ? attackCooldownRemaining / attackCooldownMs : 0;
        drawAttackCooldownUnderLabel(
          ctx,
          canvas.width / 2,
          canvas.height / 2,
          myLevel,
          attackCooldownProgress,
        );

        const localEmote = activeEmoteRef.current ? getEmoteById(activeEmoteRef.current) : null;
        if (localEmote && activeEmoteUntilRef.current > now) {
          drawEmoteBubble(ctx, canvas.width / 2, canvas.height / 2, localEmote.icon, myLevel, 1.6);
        }
      }

      drawKillExpNotifications(ctx, killExpNotifications.current, camX, camY, now);

      raf = requestAnimationFrame(gameLoop);
    };

    raf = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Stop host intervals and host check loop
      stopHostIntervals().catch(() => {});
      if (hostCheckIntervalRef.current) {
        clearInterval(hostCheckIntervalRef.current);
        hostCheckIntervalRef.current = null;
      }
      cancelAnimationFrame(raf);
      if (gameStateRef.current !== 'dead') {
        // count explicit client removal
        incrementDbWrites(1);
        dbRemove(userRef);
      }
      
      clearInterval(networkPoll);
      
    };
  }, [gameState, foodItems, rawClients, rawFoodItems, roomId, smoothClients]);

  const hudState = buildHudState(
    smoothClients.current,
    idRef.current,
    myScore.current,
    lastSwingTime.current,
    Date.now(),
  );

  const handlePlay = (nextPlayerName) => {
    // When starting play, always reset the menu mode back to regular menu
    setMenuMode('menu');
    const safePlayerName = String(nextPlayerName || '').trim().slice(0, 16);
    if (!safePlayerName) return;

    const now = Date.now();
    const localRawState = rawClients.current[idRef.current] || null;
    const isRespawningFromDeath = localRawState?.isDead === true;
    const startX = typeof localRawState?.x === 'number' && !isRespawningFromDeath
      ? localRawState.x
      : Math.random() * WORLD_SIZE;
    const startY = typeof localRawState?.y === 'number' && !isRespawningFromDeath
      ? localRawState.y
      : Math.random() * WORLD_SIZE;
    const startingScore = isRespawningFromDeath && typeof localRawState?.score === 'number'
      ? localRawState.score
      : 0;
    const startingKills = typeof localRawState?.kills === 'number' ? localRawState.kills : 0;

    playerNameRef.current = safePlayerName;
    setPlayerName(safePlayerName);
    setKillerName(null);
    setIsChatInputOpen(false);
    setChatDraft('');
    setIsEmoteWheelOpen(false);
    setEmoteWheelCenter(null);
    setEmoteHoveredIndex(-1);

    myWorldPos.current = { x: startX, y: startY };
    mousePos.current = { x: 0, y: 0 };
    moveAngle.current = 0;
    swingStart.current = 0;
    swingProgress.current = 0;
    lastSwingTime.current = 0;
    lastSwingHit.current = {};
    lastBotSwingHit.current = {};
    lastTime.current = 0;
    lastSent.current = 0;
    lastBotUpdate.current = 0;
    lastEnsureBots.current = 0;
    lastFoodSpawn.current = 0;
    lastSentState.current = null;
    killExpNotifications.current = [];
    notifiedKillDeaths.current = new Set();
    lastAliveClientState.current = {};
    myScore.current = startingScore;
    lastLocalScoreMutationAt.current = Date.now();
    wasDeadLastSync.current = isRespawningFromDeath;
    shiftPressed.current = false;
    boostActive.current = false;
    boostScoreAccumulator.current = 0;
    activeEmoteRef.current = null;
    activeEmoteUntilRef.current = 0;
    respawnPendingRef.current = isRespawningFromDeath;

    const clientsPath = getRoomCollectionPath(roomId, 'clients');
    // count initial client state write on play
    incrementDbWrites(1);
    dbUpdate(dbRef(db, `${clientsPath}/${idRef.current}`), {
      name: safePlayerName,
      color: colorRef.current,
      boost: false,
      swordSwing: 0,
      leftPunch: 0,
      rightPunch: 0,
      lastSwingTime: 0,
      activeEmote: null,
      emoteAt: 0,
      emoteUntil: 0,
      moveSeq: 0,
      moveSentAt: 0,
      kills: startingKills,
      ...(isRespawningFromDeath
        ? {
          respawnRequestedAt: now,
        }
        : {
          x: startX,
          y: startY,
          angle: 0,
          swordAngle: 0,
          score: 0,
          isDead: false,
          killerId: null,
          killExpGain: 0,
          deathAt: 0,
          invulnerableUntil: 0,
          respawnRequestedAt: 0,
        }),
      lastSeen: now,
      updatedAt: now,
    }).catch((err) => {
      console.error('start game error', err);
    });

    gameStateRef.current = 'playing';
    setGameState('playing');
  };

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#1a1a1a' }}>
      {gameState === 'menu' && (
        <MainMenu
          mode={menuMode}
          killerName={killerName}
          roomId={roomId}
          onPlay={handlePlay}
        />
      )}

      {gameState === 'dead' && (
        <DeathOverlay
          visible={true}
          killerName={killerName}
          onRespawn={() => {
            setMenuMode('dead');
            setGameState('menu');
          }}
        />
      )}

      {(gameState === 'playing' || gameState === 'dead') && (
        <>
          <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />
          {gameState === 'playing' && <GameHud hud={hudState} />}
          <RoomChatBox messages={chatMessages} />
          <EmoteWheel visible={isEmoteWheelOpen} center={emoteWheelCenter} hoveredIndex={emoteHoveredIndex} />
          {isChatInputOpen && gameState === 'playing' && (
            <ChatInputOverlay
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              inputRef={chatInputRef}
            />
          )}
        </>
      )}
    </div>
  );
}

export default App;
