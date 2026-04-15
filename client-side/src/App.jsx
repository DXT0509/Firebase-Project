import React, { useEffect, useRef, useState } from 'react';
// Firebase Realtime Database (modular v9)
// NOTE: we intentionally use child-based listeners to avoid reloading whole trees.
import {
  ref as dbRef,
  set as dbSet,
  get as dbGet,
  remove as dbRemove,
  onDisconnect,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
} from 'firebase/database';
import { db } from './firebase/config';
import { spawnFood } from './simulators/Spawn';
import { ensureBots, updateBotsTowardFood } from './simulators/Bot';

// --- CẤU HÌNH HẰNG SỐ ---
const WORLD_SIZE = 5000;
const SPEED = 300;
const SPEED_BOOST_MULTIPLIER = 1.3;
const BOOST_SCORE_DRAIN_PER_SEC = 20; // trừ 20 điểm mỗi giây khi giữ Shift
// NETWORK_TICK: gửi trạng thái lên Firebase ~8–10 lần/giây thay vì 20 lần/giây
// để giảm băng thông nhưng vẫn mượt nhờ nội suy client-side.
const TICK_RATE = 120; // ms
// LERP_FACTOR cao hơn để mượt giữa các lần update thưa hơn (0.25–0.35 được khuyến nghị)
const LERP_FACTOR = 0.3;
const PLAYER_SIZE = 60; // kích cỡ cơ bản level 1
const PUNCH_EXTRA = PLAYER_SIZE * 0.6;
const PUNCH_DURATION = 200;
const PUNCH_COOLDOWN = 500;
const PUNCH_CONVERGENCE = 0.5;
const FOOD_BASE_RADIUS = 4; // bán kính cơ bản cho food size 1

// Bot & food tick dành riêng cho host (chỉ một client thực thi)
// Bot update ~24–25 lần/giây để di chuyển rất mượt (gần 24fps)
const BOT_UPDATE_INTERVAL_MS = 40; // ms
const BOT_ENSURE_INTERVAL_MS = 5000; // đảm bảo lại số bot mỗi 5s
const FOOD_SPAWN_INTERVAL_MS = 1000; // spawn food tối đa 1 lần/giây

// Culling margin để vẽ/lerp thêm 1 chút ngoài màn hình tránh pop-in
const VIEW_MARGIN = 100;

// Bảng level theo score
const EVOWARS_XP_TABLE = [
  { level: 1, score: 0 },
  { level: 2, score: 100 },
  { level: 3, score: 200 },
  { level: 4, score: 350 },
  { level: 5, score: 500 },
  { level: 6, score: 700 },
  { level: 7, score: 900 },
  { level: 8, score: 1150 },
  { level: 9, score: 1400 },
  { level: 10, score: 1700 },

  { level: 11, score: 2050 },
  { level: 12, score: 2400 },
  { level: 13, score: 2800 },
  { level: 14, score: 3200 },
  { level: 15, score: 3700 },
  { level: 16, score: 4200 },
  { level: 17, score: 4800 },
  { level: 18, score: 5400 },
  { level: 19, score: 6100 },
  { level: 20, score: 6800 },

  { level: 21, score: 8200 },
  { level: 22, score: 10000 },
  { level: 23, score: 12500 },
  { level: 24, score: 15500 },
  { level: 25, score: 19500 },
  { level: 26, score: 24000 },
  { level: 27, score: 30000 },
  { level: 28, score: 37000 },
  { level: 29, score: 46000 },
  { level: 30, score: 58000 },

  { level: 31, score: 72000 },
  { level: 32, score: 90000 },
  { level: 33, score: 115000 },
  { level: 34, score: 145000 },
  { level: 35, score: 180000 },
  { level: 36, score: 220000 },
  { level: 37, score: 270000 },
  { level: 38, score: 330000 },
  { level: 39, score: 400000 },
  { level: 40, score: 480000 },
];

const MAX_LEVEL = 40;

const getLevelFromScore = (score) => {
  if (!Number.isFinite(score) || score <= 0) return 1;
  let level = 1;
  for (let i = 0; i < EVOWARS_XP_TABLE.length; i++) {
    if (score >= EVOWARS_XP_TABLE[i].score) {
      level = EVOWARS_XP_TABLE[i].level;
    } else {
      break;
    }
  }
  if (level < 1) return 1;
  if (level > MAX_LEVEL) return MAX_LEVEL;
  return level;
};

// Mỗi level tăng cố định +2 đơn vị kích cỡ so với level trước.
// Level 1: PLAYER_SIZE, level 2: PLAYER_SIZE + 2, ..., level 40: PLAYER_SIZE + 2 * 39.
const getSizeFromLevel = (level) => {
  return PLAYER_SIZE + (level-1) * 4;
};

function App() {
  const canvasRef = useRef(null);
  const [renderTrigger, setRenderTrigger] = useState(0);

  // Refs quản lý logic (không gây re-render)
  const myWorldPos = useRef({ x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 });
  const mousePos = useRef({ x: 0, y: 0 });
  const idRef = useRef(crypto.randomUUID());
  const colorRef = useRef(`hsl(${Math.floor(Math.random() * 360)}, 80%, 50%)`);

  // Animation đấm
  const punchHand = useRef(null);
  const punchStart = useRef(0);
  const punchProgress = useRef(0);
  const nextPunchHand = useRef(0);
  const lastPunchTime = useRef(0);
  const lastPunchHit = useRef({});

  const firebaseClients = useRef({});
  const smoothClients = useRef({});
  const foodItems = useRef({});
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

  // --- HÀM VẼ NHÂN VẬT TRÊN CANVAS ---
  const drawPlayer = (ctx, x, y, angle, color, leftP, rightP, label, size) => {
    const bodySize = size || PLAYER_SIZE;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const handSize = bodySize * 0.35;
    const handOffsetSide = bodySize * 0.35;
    const baseForward = bodySize * 0.45;

    // Tính toán vị trí tay hội tụ về tâm
    const leftF = baseForward + leftP * PUNCH_EXTRA;
    const leftS = handOffsetSide * (1 - leftP * PUNCH_CONVERGENCE);
    const rightF = baseForward + rightP * PUNCH_EXTRA;
    const rightS = handOffsetSide * (1 - rightP * PUNCH_CONVERGENCE);

    ctx.shadowBlur = 10;
    ctx.shadowColor = "rgba(0,0,0,0.3)";
    ctx.shadowOffsetY = 4;

    // Vẽ tay trái
    ctx.fillStyle = color;
    ctx.strokeStyle = "white";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(leftF, -leftS, handSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Vẽ tay phải
    ctx.beginPath();
    ctx.arc(rightF, rightS, handSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Vẽ thân
    ctx.beginPath();
	ctx.arc(0, 0, bodySize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Vẽ chữ (Xoay ngược lại để chữ luôn thẳng)
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowBlur = 4;
    ctx.shadowColor = "black";

    const baseY = bodySize / 2 + 20;
    let levelText = "";
    let nameText = label || "";

    if (label) {
      const parts = String(label).split(" ");
      if (parts[0].startsWith("Lv")) {
        levelText = parts[0].slice(2);
        nameText = parts.slice(1).join(" ");
      }
    }

    if (levelText) {
      const diamondSize = 18;
      const half = diamondSize / 2;
      const gap = 6;

      // Vẽ hình thoi làm badge level bên trái
      const badgeX = -half - gap;

      // Nền hình thoi
      ctx.save();
      ctx.translate(badgeX, baseY);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.strokeStyle = "#ffd54f";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(-half, -half, diamondSize, diamondSize);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Số level bên trong hình thoi (không xoay)
      ctx.save();
      ctx.translate(badgeX, baseY);
      ctx.fillStyle = "#ffd54f";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(levelText, 0, 0);
      ctx.restore();

      // Tên player bên phải badge
      if (nameText) {
        ctx.fillStyle = "white";
        ctx.font = "bold 13px Arial";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(nameText, gap, baseY);
      }
    } else {
      // Fallback: chỉ vẽ nguyên label như cũ
      ctx.fillStyle = "white";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(label, 0, baseY);
    }

    ctx.restore();
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    const handleMouseMove = (e) => {
      mousePos.current = { x: e.clientX - canvas.width / 2, y: e.clientY - canvas.height / 2 };
    };
    const handleClick = () => {
      const now = Date.now();
      if ((punchStart.current && now - punchStart.current < PUNCH_DURATION) || (now - lastPunchTime.current < PUNCH_COOLDOWN)) return;
      punchHand.current = nextPunchHand.current;
      punchStart.current = now;
      lastPunchTime.current = now;
      nextPunchHand.current = nextPunchHand.current === 0 ? 1 : 0;
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Shift') {
        shiftPressed.current = true;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Shift') {
        shiftPressed.current = false;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Firebase
    const userRef = dbRef(db, `clients/${idRef.current}`);
    const clientsRef = dbRef(db, 'clients');
    const foodRef = dbRef(db, 'food');
    const hostRef = dbRef(db, 'host');

    // Xoá client của mình khi disconnect để tránh rác dữ liệu
    onDisconnect(userRef).remove();

    // --- Simple host detection: client đầu tiên đặt /host trở thành host ---
    // Các client còn lại chỉ đọc dữ liệu, KHÔNG chạy bot logic.
    const claimHostIfFree = async () => {
      try {
        const snap = await dbGet(hostRef);
        const current = snap.val();
        if (!current || !current.id) {
          await dbSet(hostRef, { id: idRef.current, ts: Date.now() });
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
      if (isHost.current) return;
      claimHostIfFree();
    }, 5000);

    // --- CLIENTS LISTENERS (child-based) ---
    const upsertClient = (id, data) => {
      if (!data) return;
      firebaseClients.current[id] = data;
      if (id === idRef.current && typeof data.score === 'number') {
        // Cập nhật lại myScore từ server để bảng xếp hạng luôn chuẩn
        myScore.current = data.score;
      }
      setRenderTrigger((t) => t + 1); // trigger re-render cho UI (bảng xếp hạng)
    };

    const unsubscribeClientAdded = onChildAdded(clientsRef, (snap) => {
      upsertClient(snap.key, snap.val());
    });

    const unsubscribeClientChanged = onChildChanged(clientsRef, (snap) => {
      upsertClient(snap.key, snap.val());
    });

    const unsubscribeClientRemoved = onChildRemoved(clientsRef, (snap) => {
      const id = snap.key;
      delete firebaseClients.current[id];
      delete smoothClients.current[id];
      setRenderTrigger((t) => t + 1);
    });

    const unsubscribeClients = () => {
      unsubscribeClientAdded();
      unsubscribeClientChanged();
      unsubscribeClientRemoved();
    };

    // --- FOOD LISTENERS (child-based) ---
    const unsubscribeFoodAdded = onChildAdded(foodRef, (snap) => {
      foodItems.current[snap.key] = snap.val();
    });

    const unsubscribeFoodChanged = onChildChanged(foodRef, (snap) => {
      foodItems.current[snap.key] = snap.val();
    });

    const unsubscribeFoodRemoved = onChildRemoved(foodRef, (snap) => {
      delete foodItems.current[snap.key];
    });

    const unsubscribeFood = () => {
      unsubscribeFoodAdded();
      unsubscribeFoodChanged();
      unsubscribeFoodRemoved();
    };

    const gameLoop = (ts) => {
      // --- HOST-ONLY LOGIC: bot AI + food spawn ---
      if (isHost.current) {
        if (!lastFoodSpawn.current || ts - lastFoodSpawn.current > FOOD_SPAWN_INTERVAL_MS) {
          lastFoodSpawn.current = ts;
          spawnFood().catch((err) => console.error('spawnFood error', err));
        }

        if (!lastEnsureBots.current || ts - lastEnsureBots.current > BOT_ENSURE_INTERVAL_MS) {
          lastEnsureBots.current = ts;
          ensureBots().catch((err) => {
            console.error('ensureBots error', err);
          });
        }

        // Tick bot: cho bot di chuyển kiếm food gần nhất với tần suất thấp hơn
        if (!lastBotUpdate.current || ts - lastBotUpdate.current > BOT_UPDATE_INTERVAL_MS) {
          lastBotUpdate.current = ts;
          // Truyền cache local firebaseClients/foodItems vào bot AI để tránh get() mỗi tick.
          updateBotsTowardFood(firebaseClients.current, foodItems.current).catch((err) =>
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
        const currentSpeed = SPEED * speedMultiplier;
        myWorldPos.current.x = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.x + (dx / dist) * currentSpeed * dt));
        myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.y + (dy / dist) * currentSpeed * dt));
      }

      const now = Date.now();
      if (punchStart.current) {
        const t = Math.min(1, (now - punchStart.current) / PUNCH_DURATION);
        punchProgress.current = t < 0.5 ? t / 0.5 : (1 - t) / 0.5;
        if (t >= 1) punchStart.current = 0;
      }

      // 2. Nội suy (Lerp) người chơi khác
      Object.keys(firebaseClients.current).forEach(id => {
      if (id === idRef.current) return;
      const target = firebaseClients.current[id];
      
      if (!smoothClients.current[id]) {
        // Nếu là người chơi mới, khởi tạo giá trị ban đầu
        smoothClients.current[id] = { 
          ...target, 
          leftPunch: 0, 
          rightPunch: 0 
        };
      } else {
        const s = smoothClients.current[id];
        
        // Lerp di chuyển (Bạn đã có)
        s.x += (target.x - s.x) * LERP_FACTOR;
        s.y += (target.y - s.y) * LERP_FACTOR;
        
        // --- FIX LAG ĐẤM Ở ĐÂY ---
        // Thay vì gán s.leftPunch = target.leftPunch, hãy dùng Lerp
        // Dùng hệ số cao hơn (0.3 - 0.4) để cú đấm phản hồi nhanh nhưng vẫn mượt
        const PUNCH_LERP = 0.35; 
        s.leftPunch = (s.leftPunch || 0) + (target.leftPunch - (s.leftPunch || 0)) * PUNCH_LERP;
        s.rightPunch = (s.rightPunch || 0) + (target.rightPunch - (s.rightPunch || 0)) * PUNCH_LERP;
        
        // Lerp góc quay (Bạn đã có)
        let aDiff = target.angle - (s.angle || 0);
        while (aDiff <= -Math.PI) aDiff += Math.PI * 2;
        while (aDiff > Math.PI) aDiff -= Math.PI * 2;
        s.angle = (s.angle || 0) + aDiff * LERP_FACTOR;
        
        s.color = target.color;
      }
    });

      // 3. Gửi Firebase (networking) – tách tick mạng khỏi FPS và chỉ gửi khi state đổi đáng kể
      if (now - lastSent.current > TICK_RATE) {
        const angle = Math.atan2(mousePos.current.y, mousePos.current.x);
        const payload = {
          x: myWorldPos.current.x,
          y: myWorldPos.current.y,
          color: colorRef.current,
          angle,
          leftPunch: punchHand.current === 0 ? punchProgress.current : 0,
          rightPunch: punchHand.current === 1 ? punchProgress.current : 0,
          score: myScore.current,
          boost: boostActive.current,
          lastSeen: now,
        };

        const prev = lastSentState.current;
        const dxNet = !prev ? Infinity : payload.x - prev.x;
        const dyNet = !prev ? Infinity : payload.y - prev.y;
        const movedFarEnough = !prev || Math.hypot(dxNet, dyNet) > 3; // chỉ gửi nếu dịch chuyển đủ xa
        const punchChanged =
          !prev ||
          prev.leftPunch !== payload.leftPunch ||
          prev.rightPunch !== payload.rightPunch;
        const boostChanged = !prev || prev.boost !== payload.boost;

        if (movedFarEnough || punchChanged || boostChanged) {
          lastSent.current = now;
          lastSentState.current = payload;
          dbSet(userRef, payload);
        }
      }

      // 4. VẼ LÊN CANVAS
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const camX = canvas.width / 2 - myWorldPos.current.x;
      const camY = canvas.height / 2 - myWorldPos.current.y;
      const myAngle = Math.atan2(mousePos.current.y, mousePos.current.x);

      // --- RENDERING ---
      // Vẽ nền Grid cũ
      ctx.fillStyle = "#a8ffa8";
      ctx.fillRect(camX, camY, WORLD_SIZE, WORLD_SIZE);
      ctx.strokeStyle = "rgba(70, 76, 70, 0.3)";
      ctx.lineWidth = 4;
      for (let i = 0; i <= WORLD_SIZE; i += 75) {
        ctx.beginPath(); ctx.moveTo(camX + i, camY); ctx.lineTo(camX + i, camY + WORLD_SIZE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(camX, camY + i); ctx.lineTo(camX + WORLD_SIZE, camY + i); ctx.stroke();
      }

      // Vẽ food (hình tròn nhỏ), kích thước theo size trong database
      // Đồng thời xử lý va chạm giữa player và food (ăn food)
      const foodsToRemove = [];
      const myLevel = getLevelFromScore(myScore.current);
      const mySize = getSizeFromLevel(myLevel);
      const myRadius = mySize / 2;

      Object.entries(foodItems.current).forEach(([foodId, food]) => {
        if (!food) return;
        const size = food.size || 1;
        const radius = FOOD_BASE_RADIUS * size;

        // Va chạm với player (player là hình tròn radius = myRadius)
        const dxFood = food.x - myWorldPos.current.x;
        const dyFood = food.y - myWorldPos.current.y;
        const distFood = Math.hypot(dxFood, dyFood);
        if (distFood < radius + myRadius) {
          foodsToRemove.push(foodId);
          // Cộng điểm theo size của food
          if (size === 1) myScore.current += 8;
          else if (size === 2) myScore.current += 19;
          else myScore.current += 40;
          return; // Không vẽ nữa vì đã bị ăn
        }

        const fx = food.x + camX;
        const fy = food.y + camY;

        // Culling: bỏ qua vẽ nếu food nằm ngoài màn hình + margin
        if (
          fx + radius < -VIEW_MARGIN ||
          fx - radius > canvas.width + VIEW_MARGIN ||
          fy + radius < -VIEW_MARGIN ||
          fy - radius > canvas.height + VIEW_MARGIN
        ) {
          return;
        }
        ctx.save();
        ctx.fillStyle = food.color || '#ffeb3b';
        ctx.beginPath();
        ctx.arc(fx, fy, radius, 0, Math.PI * 2);
        ctx.fill();
        // Vẽ thêm 1 dấu gạch ngang trắng bên trong food
        ctx.strokeStyle = 'white';
        ctx.lineWidth = Math.min(3, radius * 0.4);
        ctx.beginPath();
        ctx.moveTo(fx - radius * 0.6, fy);
        ctx.lineTo(fx + radius * 0.6, fy);
        ctx.stroke();
        ctx.restore();
      });

      // Xoá các food đã bị ăn khỏi Firebase
      if (foodsToRemove.length > 0) {
        foodsToRemove.forEach(id => {
          const fRef = dbRef(db, `food/${id}`);
          dbRemove(fRef);
        });
      }

      // Vẽ người chơi khác (chỉ vẽ các entity nằm trong viewport để giảm draw-call)
      Object.entries(smoothClients.current).forEach(([id, p]) => {
        if (!firebaseClients.current[id]) { delete smoothClients.current[id]; return; }
        const fbClient = firebaseClients.current[id];
        const enemyScore = typeof fbClient?.score === 'number' ? fbClient.score : 0;
        const enemyLevel = getLevelFromScore(enemyScore);
        const enemySize = getSizeFromLevel(enemyLevel);
        const enemyName = fbClient?.name || id.slice(0, 3).toUpperCase();
        const enemyLabel = `Lv${enemyLevel} ${enemyName}`;

        // Culling theo vị trí world + viewport
        const ex = p.x + camX;
        const ey = p.y + camY;
        const enemyRadius = enemySize / 2;
        if (
          ex + enemyRadius < -VIEW_MARGIN ||
          ex - enemyRadius > canvas.width + VIEW_MARGIN ||
          ey + enemyRadius < -VIEW_MARGIN ||
          ey - enemyRadius > canvas.height + VIEW_MARGIN
        ) {
          return;
        }
        // Kiểm tra va chạm nắm đấm của mình với player khác
        if (punchHand.current !== null && punchProgress.current > 0) {
          const myLevelForPunch = myLevel;
          const mySizeForPunch = mySize;
          const baseForward = mySizeForPunch * 0.45;
          const handOffsetSide = mySizeForPunch * 0.35;
          const bodyRadius = mySizeForPunch / 2;
          const handRadius = mySizeForPunch * 0.175; // cùng tỉ lệ với drawPlayer

          const leftP = punchHand.current === 0 ? punchProgress.current : 0;
          const rightP = punchHand.current === 1 ? punchProgress.current : 0;

          const cx = myWorldPos.current.x;
          const cy = myWorldPos.current.y;

          const applyHit = () => {
            if (lastPunchHit.current[id] === lastPunchTime.current) return;
            lastPunchHit.current[id] = lastPunchTime.current;
            p.y += 10; // tạm thời chỉ đẩy Y xuống 10 (client-side)

            // Cập nhật luôn vị trí trên Firebase để mọi client thấy knockback
            const targetNow = firebaseClients.current[id];
            if (targetNow) {
              const victimRef = dbRef(db, `clients/${id}`);
              dbSet(victimRef, {
                ...targetNow,
                y: targetNow.y + 10,
              });
            }
          };

          if (leftP > 0) {
            const leftF = baseForward + leftP * PUNCH_EXTRA;
            const leftS = handOffsetSide * (1 - leftP * PUNCH_CONVERGENCE);
            const lxLocal = leftF;
            const lyLocal = -leftS;
            const lxWorld = cx + lxLocal * Math.cos(myAngle) - lyLocal * Math.sin(myAngle);
            const lyWorld = cy + lxLocal * Math.sin(myAngle) + lyLocal * Math.cos(myAngle);
            const dist = Math.hypot(p.x - lxWorld, p.y - lyWorld);
            if (dist < bodyRadius + handRadius) applyHit();
          }

          if (rightP > 0) {
            const rightF = baseForward + rightP * PUNCH_EXTRA;
            const rightS = handOffsetSide * (1 - rightP * PUNCH_CONVERGENCE);
            const rxLocal = rightF;
            const ryLocal = rightS;
            const rxWorld = cx + rxLocal * Math.cos(myAngle) - ryLocal * Math.sin(myAngle);
            const ryWorld = cy + rxLocal * Math.sin(myAngle) + ryLocal * Math.cos(myAngle);
            const dist = Math.hypot(p.x - rxWorld, p.y - ryWorld);
            if (dist < bodyRadius + handRadius) applyHit();
          }
        }

        drawPlayer(ctx, ex, ey, p.angle, p.color, p.leftPunch, p.rightPunch, enemyLabel, enemySize);

        // Hiệu ứng tăng tốc cho player khác nếu họ đang boost
        if (fbClient && fbClient.boost) {
          ctx.save();
          ctx.translate(ex, ey);
          const pulse = (Math.sin(Date.now() / 80) + 1) / 2;
          const radius = enemySize / 2 + 18 + pulse * 10;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.lineWidth = 5;
          ctx.shadowBlur = 20;
          ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      });

            // Vẽ bản thân (size theo level)
            const selfLabel = `Lv${myLevel} YOU`;
            drawPlayer(ctx, canvas.width / 2, canvas.height / 2, myAngle, colorRef.current,
              punchHand.current === 0 ? punchProgress.current : 0,
              punchHand.current === 1 ? punchProgress.current : 0, selfLabel, mySize);

      // Hiệu ứng tăng tốc quanh nhân vật khi đang boost
      if (boostActive.current) {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        const pulse = (Math.sin(Date.now() / 80) + 1) / 2; // 0..1
        const radius = mySize / 2 + 18 + pulse * 10;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 5;
        ctx.shadowBlur = 20;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      requestAnimationFrame(gameLoop);
    };

    const raf = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      cancelAnimationFrame(raf);
      dbRemove(userRef);
      unsubscribeClients();
      unsubscribeFood();
      clearInterval(hostPoll);
    };
  }, []);

  // --- TÍNH TOÁN BẢNG XẾP HẠNG ---
  const clientsArray = Object.entries(firebaseClients.current || {}).map(([id, c]) => ({
    id,
    name: c?.name || id.slice(0, 4).toUpperCase(),
    score: typeof c?.score === 'number' ? c.score : 0,
  }));

  const sortedByScore = [...clientsArray].sort((a, b) => b.score - a.score);
  const rankMap = {};
  sortedByScore.forEach((c, idx) => {
    rankMap[c.id] = idx + 1;
  });

  const myId = idRef.current;
  const myIndex = sortedByScore.findIndex(c => c.id === myId);
  const myScoreValue = typeof firebaseClients.current?.[myId]?.score === 'number' ? firebaseClients.current[myId].score : myScore.current;
  const myLevel = getLevelFromScore(myScoreValue);
  const myNextLevel = Math.min(MAX_LEVEL, myLevel + 1);
  const currentLevelEntry = EVOWARS_XP_TABLE.find(e => e.level === myLevel) || EVOWARS_XP_TABLE[0];
  const nextLevelEntry = EVOWARS_XP_TABLE.find(e => e.level === myNextLevel) || currentLevelEntry;
  const currScoreForLevel = currentLevelEntry.score;
  const nextScoreForLevel = nextLevelEntry.score;
  const scoreForBar = Math.max(0, myScoreValue - currScoreForLevel);
  const scoreNeededForBar = Math.max(1, nextScoreForLevel - currScoreForLevel);
  const levelProgress = Math.max(0, Math.min(1, scoreForBar / scoreNeededForBar));
  let leaderboardRows = [];

  if (sortedByScore.length <= 5) {
    leaderboardRows = sortedByScore;
  } else if (myIndex !== -1 && myIndex < 4) {
    // Tôi nằm trong top 4 => hiển thị 5 người top đầu
    leaderboardRows = sortedByScore.slice(0, 5);
  } else {
    // Top 4 + tôi (nếu tồn tại)
    const top4 = sortedByScore.slice(0, 4);
    const meRow = sortedByScore.find(c => c.id === myId);
    leaderboardRows = meRow ? [...top4, meRow] : top4;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#1a1a1a' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {/* Level bar ở bottom center */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          minWidth: 260,
          maxWidth: 360,
          padding: '8px 14px',
          borderRadius: 16,
          background: 'rgba(0,0,0,0.5)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          color: '#f5f5f5',
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 12,
          pointerEvents: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontWeight: 700 }}>Level {myLevel}</span>
          <span style={{ opacity: 0.8 }}>
            {myScoreValue} / {nextScoreForLevel} XP
          </span>
        </div>
        <div
          style={{
            width: '100%',
            height: 10,
            borderRadius: 999,
            background: 'rgba(255,255,255,0.15)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${levelProgress * 100}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #4ade80, #22c55e, #16a34a)',
              transition: 'width 0.15s linear',
            }}
          />
        </div>
      </div>
      {/* Bảng xếp hạng */}
      <div
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          background: 'rgba(56, 48, 48, 0.75)',
          padding: '0px 14px',
          borderRadius: '16px',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          minWidth: 220,
          fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#dbd0d0',
          fontSize: 12,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Leaderboard</div>
        <div style={{ display: 'flex', fontWeight: 600, opacity: 0.7, marginBottom: 4 }}>
          <div style={{ width: 24, textAlign: 'left' }}>#</div>
          <div style={{ flex: 1, textAlign: 'left' }}>Name</div>
          <div style={{ width: 60, textAlign: 'right' }}>Score</div>
        </div>
        {leaderboardRows.map(row => {
          const isMe = row.id === myId;
          const rowLevel = getLevelFromScore(row.score);
          return (
            <div
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: 2,
                padding: '2px 4px',
                background: isMe ? 'rgba(107, 104, 104, 0.8)' : 'transparent',
                color: '#dbd0d0',
              }}
            >
              <div style={{ width: 24, textAlign: 'left' }}>{rankMap[row.id]}</div>
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  textAlign: 'left',
                  overflow: 'hidden',
                  paddingRight: 4,
                }}
              >
                {/* Badge level hình thoi nhỏ gọn */}
                <div
                  style={{
                    position: 'relative',
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    marginLeft: 3,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(135deg, #facc15, #f97316)',
                      transform: 'rotate(45deg)',
                      borderRadius: 3,
                      boxShadow: '0 0 4px rgba(0,0,0,0.45)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      fontWeight: 700,
                      color: '#1f2933',
                    }}
                  >
                    {rowLevel}
                  </div>
                </div>
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.name}
                </span>
              </div>
              <div style={{ width: 60, textAlign: 'right' }}>{row.score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default App;