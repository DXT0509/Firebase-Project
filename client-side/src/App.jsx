import React, { useEffect, useRef, useState } from 'react';
import { ref as dbRef, set as dbSet, onValue, remove as dbRemove, onDisconnect } from 'firebase/database';
import { db } from './firebase/config';
import { spawnFood } from './simulators/Spawn';

// --- CẤU HÌNH HẰNG SỐ ---
const WORLD_SIZE = 4000;
const SPEED = 300;
const TICK_RATE = 50;
const LERP_FACTOR = 0.15;
const PLAYER_SIZE = 60; 
const PUNCH_EXTRA = PLAYER_SIZE * 0.6;
const PUNCH_DURATION = 200;
const PUNCH_COOLDOWN = 500;
const PUNCH_CONVERGENCE = 0.5;
const FOOD_BASE_RADIUS = 4; // bán kính cơ bản cho food size 1

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

  // --- HÀM VẼ NHÂN VẬT TRÊN CANVAS ---
  const drawPlayer = (ctx, x, y, angle, color, leftP, rightP, label) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const handSize = PLAYER_SIZE * 0.35;
    const handOffsetSide = PLAYER_SIZE * 0.35;
    const baseForward = PLAYER_SIZE * 0.45;

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
    ctx.arc(0, 0, PLAYER_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Vẽ chữ (Xoay ngược lại để chữ luôn thẳng)
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "white";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "center";
    ctx.shadowBlur = 4;
    ctx.shadowColor = "black";
    ctx.fillText(label, 0, 5);
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

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleClick);

    // Firebase
    const userRef = dbRef(db, `clients/${idRef.current}`);
    onDisconnect(userRef).remove();
    const unsubscribeClients = onValue(dbRef(db, 'clients'), (snap) => {
      firebaseClients.current = snap.val() || {};
    });

    const unsubscribeFood = onValue(dbRef(db, 'food'), (snap) => {
      foodItems.current = snap.val() || {};
    });

    const gameLoop = (ts) => {
      spawnFood(); // Gọi hàm spawnFood định kỳ
      const dt = (ts - (lastTime.current || ts)) / 1000;
      lastTime.current = ts;

      // 1. Logic di chuyển & Animation
      const dx = mousePos.current.x, dy = mousePos.current.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        myWorldPos.current.x = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.x + (dx / dist) * SPEED * dt));
        myWorldPos.current.y = Math.max(0, Math.min(WORLD_SIZE, myWorldPos.current.y + (dy / dist) * SPEED * dt));
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

      // 3. Gửi Firebase
      if (now - lastSent.current > TICK_RATE) {
        lastSent.current = now;
        const angle = Math.atan2(mousePos.current.y, mousePos.current.x);
        dbSet(userRef, {
          x: myWorldPos.current.x, y: myWorldPos.current.y, color: colorRef.current, angle,
          leftPunch: (punchHand.current === 0 ? punchProgress.current : 0),
          rightPunch: (punchHand.current === 1 ? punchProgress.current : 0),
          lastSeen: now
        });
      }

      // 4. VẼ LÊN CANVAS
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const camX = canvas.width / 2 - myWorldPos.current.x;
      const camY = canvas.height / 2 - myWorldPos.current.y;
      const myAngle = Math.atan2(mousePos.current.y, mousePos.current.x);

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
      Object.entries(foodItems.current).forEach(([foodId, food]) => {
        if (!food) return;
        const radius = FOOD_BASE_RADIUS * (food.size || 1);

        // Va chạm với player (player là hình tròn radius = PLAYER_SIZE / 2)
        const dxFood = food.x - myWorldPos.current.x;
        const dyFood = food.y - myWorldPos.current.y;
        const distFood = Math.hypot(dxFood, dyFood);
        if (distFood < radius + PLAYER_SIZE / 2) {
          foodsToRemove.push(foodId);
          return; // Không vẽ nữa vì đã bị ăn
        }

        const fx = food.x + camX;
        const fy = food.y + camY;
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

      // Vẽ người chơi khác
      Object.entries(smoothClients.current).forEach(([id, p]) => {
        if (!firebaseClients.current[id]) { delete smoothClients.current[id]; return; }
        // Kiểm tra va chạm nắm đấm của mình với player khác
        if (punchHand.current !== null && punchProgress.current > 0) {
          const baseForward = PLAYER_SIZE * 0.45;
          const handOffsetSide = PLAYER_SIZE * 0.35;
          const bodyRadius = PLAYER_SIZE / 2;
          const handRadius = PLAYER_SIZE * 0.175; // cùng tỉ lệ với drawPlayer

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

        drawPlayer(ctx, p.x + camX, p.y + camY, p.angle, p.color, p.leftPunch, p.rightPunch, id.slice(0, 3).toUpperCase());
      });

      // Vẽ bản thân
      drawPlayer(ctx, canvas.width / 2, canvas.height / 2, myAngle, colorRef.current, 
                 punchHand.current === 0 ? punchProgress.current : 0, 
                 punchHand.current === 1 ? punchProgress.current : 0, "YOU");

      requestAnimationFrame(gameLoop);
    };

    const raf = requestAnimationFrame(gameLoop);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleClick);
      cancelAnimationFrame(raf);
      dbRemove(userRef);
      unsubscribeClients();
      unsubscribeFood();
    };
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', background: '#1a1a1a' }}>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {/* UI giữ nguyên bằng React vì React làm UI rất tốt */}
      <div style={{
        position: 'absolute', top: 20, left: 20, background: 'rgba(255, 255, 255, 0.9)',
        padding: '10px 20px', borderRadius: '20px', pointerEvents: 'none'
      }}>
        Online: {Object.keys(firebaseClients.current).length}
      </div>
    </div>
  );
}

export default App;