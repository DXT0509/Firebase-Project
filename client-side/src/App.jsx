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
  BOT_UPDATE_INTERVAL_MS,
  BOT_ENSURE_INTERVAL_MS,
  FOOD_SPAWN_INTERVAL_MS,
  DEFAULT_ROOM_ID,
} from './constants/gameConfig';
import {
  getLevelFromScore,
  getSizeFromLevel,
  getSwordWorldPoints,
  checkCollision,
} from './utils/physics';
import { getAngle, getPointToSegmentDistance, normalizeAngle } from './utils/math';
import { drawPlayer, drawAttackCooldownUnderLabel } from './renderer/playerRenderer';
import { drawGrid, drawFood } from './renderer/worldRenderer';
import { useGameSync } from './hooks/useGameSync';
import { buildHudState } from './utils/hudState';
import GameHud from './components/GameHud';
import RoomChatBox from './components/RoomChatBox';
import ChatInputOverlay from './components/ChatInputOverlay';
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

  const { smoothClients, foodItems, chatMessages, rawClients, rawFoodItems } = useGameSync(roomId, idRef.current);

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
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

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
      const angle = Math.atan2(mousePos.current.y, mousePos.current.x);
      const payload = {
        x: myWorldPos.current.x,
        y: myWorldPos.current.y,
        color: colorRef.current,
        angle,
        swordAngle: moveAngle.current,
        swordSwing: swingProgress.current,
        score: myScore.current,
        boost: boostActive.current,
        lastSeen: now,
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
          boostScoreAccumulator.current -= actualPay;
          if (myScore.current <= 0) {
            myScore.current = 0;
            boostActive.current = false;
          }
        }
      } else {
        // Không tăng tốc thì reset nhẹ accumulator để tránh trừ lẹm khi nhấn lại
        boostScoreAccumulator.current = 0;
      }

      // 1. Logic di chuyển & Animation
      const dx = mousePos.current.x, dy = mousePos.current.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        moveAngle.current = getAngle(0, 0, dx, dy);
        const currentSpeed = SPEED * speedMultiplier;
        myWorldPos.current.x = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.x + (dx / dist) * currentSpeed * dt));
        myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.y + (dy / dist) * currentSpeed * dt));
      }

      // Reconcile local Y with authoritative room state so remote knockback is visible on victim client.
      const mySynced = smoothClients.current[idRef.current];
      if (mySynced && typeof mySynced.y === 'number') {
        const yDeltaFromServer = mySynced.y - myWorldPos.current.y;
        if (Math.abs(yDeltaFromServer) > 40) {
          myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, mySynced.y));
        }
      }

      const now = Date.now();
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
        myRadius,
        (food) => {
          if (!food) return;
          const size = food.size || 1;
          if (size === 1) myScore.current += 8;
          else if (size === 2) myScore.current += 19;
          else myScore.current += 40;
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
        const enemySwordAngle =
          typeof p.swordAngle === 'number'
            ? p.swordAngle
            : (typeof p.angle === 'number' ? p.angle : 0);
        const enemyRenderAngle = id.startsWith('bot-')
          ? (typeof p.angle === 'number' ? p.angle : enemySwordAngle)
          : enemySwordAngle;

        // Bot đập trúng player local
        if (id.startsWith('bot-')) {
          const botSwingStamp = typeof p.lastPunchTime === 'number' ? p.lastPunchTime : 0;
          if (enemySwing > 0 && botSwingStamp > 0) {
            const botSword = getSwordWorldPoints(p.x, p.y, enemyRenderAngle, enemySize, enemySwing, 'left');
            const bladeDistToMe = getPointToSegmentDistance(
              myWorldPos.current.x,
              myWorldPos.current.y,
              botSword.handX,
              botSword.handY,
              botSword.tipX,
              botSword.tipY,
            );
            if (bladeDistToMe < myRadius + botSword.impactRadius) {
              if (lastBotSwingHit.current[id] !== botSwingStamp) {
                lastBotSwingHit.current[id] = botSwingStamp;
                myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.y + KNOCKBACK_Y));
              }
            }
          }
        }

        // Player local chém trúng entity khác
        if (swingProgress.current > 0) {
          const mySword = getSwordWorldPoints(
            myWorldPos.current.x,
            myWorldPos.current.y,
            mySwordAngle,
            mySize,
            swingProgress.current,
            'left',
          );
          const bladeDistToEnemy = getPointToSegmentDistance(
            p.x,
            p.y,
            mySword.handX,
            mySword.handY,
            mySword.tipX,
            mySword.tipY,
          );
          if (bladeDistToEnemy < enemyRadius + mySword.impactRadius) {
            if (lastSwingHit.current[id] !== lastSwingTime.current) {
              lastSwingHit.current[id] = lastSwingTime.current;
              const targetNow = smoothClients.current[id];
              if (targetNow) {
                const nextY = Math.max(0, Math.min(WORLD_SIZE, targetNow.y + KNOCKBACK_Y));
                dbSet(dbRef(db, `${clientsPath}/${id}/y`), nextY).catch((err) => {
                  console.error('knockback write error', err);
                });
              }
            }
          }
        }

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
        );

        const enemyEmote = fbClient?.activeEmote && typeof fbClient?.emoteUntil === 'number' && fbClient.emoteUntil > now
          ? getEmoteById(fbClient.activeEmote)
          : null;
        if (enemyEmote) {
          drawEmoteBubble(ctx, ex, ey, enemyEmote.icon, enemyLevel, 1.6);
        }
      });

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

      requestAnimationFrame(gameLoop);
    };

    const raf = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('contextmenu', handleContextMenu);
      cancelAnimationFrame(raf);
      dbRemove(userRef);
      clearInterval(hostPoll);
      clearInterval(networkPoll);
    };
  }, []);

  const hudState = buildHudState(
    smoothClients.current,
    idRef.current,
    myScore.current,
    lastSwingTime.current,
    Date.now(),
  );

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#1a1a1a' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
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
    </div>
  );
}

export default App;