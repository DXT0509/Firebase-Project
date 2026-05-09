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
} from 'firebase/database';
import { db } from './firebase/config';
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
import { buildCombatHitPatches } from './utils/combat';
import GameHud from './components/GameHud';
import RoomChatBox from './components/RoomChatBox';
import ChatInputOverlay from './components/ChatInputOverlay';
import MainMenu from './components/MainMenu';
import { getRoomCollectionPath } from './firebase/paths';
import EmoteWheel from './components/EmoteWheel';
import { EMOTE_OPTIONS, EMOTE_DURATION_MS, getEmoteById } from './constants/emotes';
import { drawEmoteBubble } from './renderer/playerRenderer';

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
  const lastBotUpdate = useRef(0);
  const lastEnsureBots = useRef(0);
  const lastFoodSpawn = useRef(0);
  const lastSentState = useRef(null);
  const myScore = useRef(0);
  const lastLocalScoreMutationAt = useRef(0);
  const wasDeadLastSync = useRef(false);
  const shiftPressed = useRef(false);
  const boostActive = useRef(false);
  const boostScoreAccumulator = useRef(0);
  const isHost = useRef(false); // chỉ host mới chạy bot AI + spawn food
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

  const { smoothClients, foodItems, chatMessages, rawClients, rawFoodItems } = useGameSync(roomId, idRef.current);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    playerNameRef.current = playerName;
  }, [playerName]);

  useEffect(() => {
    if (gameState !== 'playing') return undefined;

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
    if (gameState !== 'playing') return undefined;

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

    // Xoá client của mình khi disconnect để tránh rác dữ liệu
    onDisconnect(userRef).remove();

    /**
     * Input: none.
     * Output: none (may claim host role in DB if missing/stale).
     *
     * Critical rule:
     * - Host election heartbeat must stay resilient; bot/food simulation depends on it.
     */
    const claimHostIfFree = async () => {
      try {
        const now = Date.now();
        const [hostSnap, clientsSnap] = await Promise.all([dbGet(hostRef), dbGet(clientsRootRef)]);
        const current = hostSnap.val();
        const clients = clientsSnap.val() || {};

        const hostMissing = !current || !current.id;
        const hostClientMissing = current?.id ? !clients[current.id] : true;
        const hostStale = typeof current?.ts === 'number' ? now - current.ts > 15000 : true;

        if (hostMissing || hostClientMissing || hostStale) {
          await dbSet(hostRef, { id: idRef.current, ts: now });
          isHost.current = true;
          // Tự giải phóng role host khi tab bị đóng
          onDisconnect(hostRef).remove();
        } else {
          isHost.current = current.id === idRef.current;
        }
      } catch (err) {
        console.error('claimHostIfFree error', err);
      }
    };

    // Lần đầu vào game: thử trở thành host
    claimHostIfFree();

    // Định kỳ vài giây kiểm tra nếu hiện tại không có host
    const hostPoll = setInterval(() => {
      if (isHost.current && document.visibilityState === 'visible') {
        dbSet(hostRef, { id: idRef.current, ts: Date.now() }).catch((err) => {
          console.error('host heartbeat error', err);
        });
      }
      // Always re-check host ownership so hidden/stale host tabs can be replaced.
      claimHostIfFree();
    }, 5000);

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
      const sendScore = Number.isFinite(myServerScore) && isDeadFromServer
        ? myServerScore
        : myScore.current;
      const angle = Math.atan2(mousePos.current.y, mousePos.current.x);
      const payload = {
        x: sendX,
        y: sendY,
        color: colorRef.current,
        angle,
        swordAngle: moveAngle.current,
        swordSwing: sendSwing,
        lastSwingTime: lastSwingTime.current,
        score: sendScore,
        name: playerNameRef.current || idRef.current.slice(0, 4).toUpperCase(),
        boost: boostActive.current,
        lastSeen: now,
        updatedAt: now,
        activeEmote: activeEmoteRef.current,
        emoteAt: activeEmoteRef.current ? Math.max(0, activeEmoteUntilRef.current - EMOTE_DURATION_MS) : 0,
        emoteUntil: activeEmoteRef.current ? activeEmoteUntilRef.current : 0,
      };

      const prev = lastSentState.current;
      const dxNet = !prev ? Infinity : payload.x - prev.x;
      const dyNet = !prev ? Infinity : payload.y - prev.y;
      const movedFarEnough = !prev || Math.hypot(dxNet, dyNet) > 2;
      const angleChanged = !prev || Math.abs(normalizeAngle((payload.angle || 0) - (prev.angle || 0))) > 0.05;
      const swordAngleChanged = !prev || Math.abs(normalizeAngle((payload.swordAngle || 0) - (prev.swordAngle || 0))) > 0.06;
      const swingChanged = !prev || Math.abs((payload.swordSwing || 0) - (prev.swordSwing || 0)) > 0.04;
      const boostChanged = !prev || prev.boost !== payload.boost;
      const scoreChanged = !prev || prev.score !== payload.score;
      const emoteChanged = !prev || prev.activeEmote !== payload.activeEmote || prev.emoteUntil !== payload.emoteUntil;
      const heartbeatDue = !prev || now - lastSent.current > 700;

      if (movedFarEnough || angleChanged || swordAngleChanged || swingChanged || boostChanged || scoreChanged || emoteChanged || heartbeatDue) {
        lastSent.current = now;
        lastSentState.current = payload;
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

      await Promise.all(
        entries.map(([id, patch]) =>
          dbUpdate(dbRef(db, `${clientsPath}/${id}`), patch),
        ),
      );
    };

    // Keep combat resolution off render loop; host applies authoritative kill updates.
    const combatPoll = setInterval(() => {
      const now = Date.now();
      const combatPatches = buildCombatHitPatches(rawClients.current, now);
      const writeEntries = Object.entries(combatPatches);
      Promise.all([
        ...writeEntries.map(([id, patch]) => dbUpdate(dbRef(db, `${clientsPath}/${id}`), patch)),
        processAuthoritativeRespawns(),
      ]).catch((err) => {
        console.error('authoritative combat loop error', err);
      });
    }, 50);

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
        if (!lastBotUpdate.current || ts - lastBotUpdate.current > BOT_UPDATE_INTERVAL_MS) {
          lastBotUpdate.current = ts;
          // Dùng raw snapshot (authoritative) cho simulation; smooth cache chỉ dành cho render.
          updateBotsTowardFood(rawClients.current, rawFoodItems.current, roomId).catch((err) =>
            console.error('updateBotsTowardFood error', err),
          );
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

      // --- RENDERING ---
      drawGrid(ctx, camX, camY, canvas.width, canvas.height);

      // Vẽ food (hình tròn nhỏ), kích thước theo size trong database
      // Đồng thời xử lý va chạm giữa player và food (ăn food)
      const myLevel = getLevelFromScore(myScore.current);
      const mySize = getSizeFromLevel(myLevel);
      const myRadius = mySize / 2;

      const foodsToRemove = drawFood(
        ctx,
        foodItems.current,
        camX,
        camY,
        myWorldPos.current,
        myIsDead ? -1e9 : myRadius,
        (food) => {
          if (myIsDead) return;
          if (!food) return;
          const size = food.size || 1;
          if (size === 1) myScore.current += 8;
          else if (size === 2) myScore.current += 19;
          else myScore.current += 40;
          lastLocalScoreMutationAt.current = Date.now();
        },
      );

      if (foodsToRemove.length > 0) {
        foodsToRemove.forEach((id) => {
          const fRef = dbRef(db, `${getRoomCollectionPath(roomId, 'food')}/${id}`);
          dbRemove(fRef);
        });
      }

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
      cancelAnimationFrame(raf);
      if (gameStateRef.current !== 'dead') {
        dbRemove(userRef);
      }
      clearInterval(hostPoll);
      clearInterval(networkPoll);
      clearInterval(combatPoll);
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
      {(gameState === 'menu' || gameState === 'dead') && (
        <MainMenu
          mode={gameState}
          killerName={killerName}
          roomId={roomId}
          onPlay={handlePlay}
        />
      )}

      {gameState === 'playing' && (
        <>
          <canvas ref={canvasRef} style={{ display: 'block', pointerEvents: 'none' }} />
          <GameHud hud={hudState} />
          <RoomChatBox messages={chatMessages} />
          <EmoteWheel visible={isEmoteWheelOpen} center={emoteWheelCenter} hoveredIndex={emoteHoveredIndex} />
          {isChatInputOpen && (
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
