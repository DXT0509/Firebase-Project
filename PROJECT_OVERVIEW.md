# Tổng Quan Dự Án Firebase Realtime Multiplayer Game

## 1. Mục Đích

Dự án xây dựng một game realtime multiplayer browser-based tương tự Agar.io/Evowars, sử dụng **React** cho UI overlay, **Firebase Realtime Database** làm backend đồng bộ, và **HTML5 Canvas API** cho rendering 60fps.

Mục tiêu chính:

- ✅ Trải nghiệm multiplayer realtime cho phép hàng chục player cùng lúc ăn food, chiến đấu bằng tấn công tay hoặc sword swing.
- ✅ Đồng bộ trạng thái (clients, food, chat) qua Firebase child listeners, tránh overwrite quá nhiều.
- ✅ Tách **raw (authoritative) state** từ Firebase vs **smooth (render) state** để giảm giật trong thế giới di chuyển nhanh.
- ✅ Host-only simulation: bot AI, food spawn, respawn xử lý, combat hit detection dựa vào Firebase authoritative state.
- ✅ Kiến trúc mô-đun hóa sạch, dễ scale từng tính năng mới (room, mode khác, matchmaking).

## 2. Công Nghệ & Stack

| Lớp | Công nghệ | Vai trò |
|---|---|---|
| **Frontend UI** | React 19 | UI overlay (HUD, chat, emote wheel, death screen) + state orchestration |
| **Build & Dev** | Vite 8 | Dev server nhanh, hot reload, build production |
| **Realtime Backend** | Firebase RTDB v12 | Cơ sở dữ liệu thời gian thực, child listeners, transactions |
| **Rendering** | HTML5 Canvas API | 60fps game loop, vẽ world/grid/player/food/sword/emote |
| **Networking** | WebSocket (ws lib) | Hỗ trợ cho các tính năng future |
| **UI Components** | lucide-react, Leaflet | Icon, map rendering (future) |
| **Code Quality** | ESLint 9 | Lint React + React Hooks |

**Dependencies chính:**
- `react@^19.2.4`, `react-dom@^19.2.4`
- `firebase@^12.11.0`, `vite@^8.0.4`
- `ws@^8.13.0`, `lucide-react`, `leaflet`

## 3. Cấu Trúc Thư Mục

```text
client-side/src/
├── App.jsx                    # Orchestrator game: input, render loop, network sends, host election
├── components/                # React UI layer
│   ├── GameHud.jsx           # Level, XP progress, leaderboard
│   ├── RoomChatBox.jsx       # Display chat messages
│   ├── ChatInputOverlay.jsx  # Chat input box (Enter key)
│   ├── DeathOverlay.jsx      # Death screen + respawn button
│   ├── MainMenu.jsx          # Join room selector
│   └── EmoteWheel.jsx        # Emote selection wheel (right-click)
├── constants/
│   ├── gameConfig.js         # Tuning: world size, tick rate, XP table (level 1-40), speed, cooldown
│   ├── emotes.js             # Emote spritesheet + IDs
│   └── host.js               # Host heartbeat interval (2000ms), expiry (5000ms), check (1000ms)
├── firebase/
│   ├── config.js             # Firebase RTDB singleton instance
│   └── paths.js              # getRoomCollectionPath(roomId, collection) — room namespace helper
├── hooks/
│   ├── useGameSync.js        # Orchestrate raw/smooth caches, 16ms smoothing tick
│   ├── useNetworkSync.js     # Firebase child listeners → normalize → rawClients/rawFoodItems
│   ├── useInterpolation.js   # Lerp position/angle for remote players (not local)
│   └── usePrediction.js      # Movement prediction for remote players (exclude bots)
├── renderer/
│   ├── playerRenderer.js     # Draw player, sword arc, punch, cooldown bar, emote bubble
│   └── worldRenderer.js      # Draw grid, food particles
├── simulators/
│   ├── Bot.js                # Bot entity, AI (chase food), respawn, combat state
│   ├── Spawn.js              # Maintain target food count in room
│   └── PowerupSpawn.js       # (Future) powerup spawner
└── utils/
    ├── combat.js             # buildCombatHitPatches(), buildKillScoreDelta()
    ├── foodConsumption.js    # consumeFoodTransaction(), atomic food eat
    ├── physics.js            # Collision, level/size math, sword worldPoints
    ├── math.js               # Angle, distance, normalization
    ├── hudState.js           # Build HUD state from game state
    └── index.css             # Global styles
```

## 4. Mô-đun Chính Chi Tiết

### 4.1 App.jsx — Trình Chỉ Huy Game

Đây là orchestrator chính, chứa:

**Input Handling:**
- Bàn phím: W/A/S/D di chuyển, Shift boost, Enter chat, Right-click emote
- Chuột: Click để punch, drag để sword swing
- UI: respawn button, emote selection

**Simulation Loops:**
- **Network send loop** (50ms): gửi local player state (x, y, angle, punch/swing timing, score)
- **Combat loop** (50ms, host-only): 
  - `buildCombatHitPatches()` kiểm tra collision punch/sword vs remote player
  - Viết hit patch lên Firebase → trigger death/respawn/kill score
- **Bot loop** (80ms, host-only): update bot position toward food, handle bot collision
- **Bot ensure loop** (5s, host-only): spawn/despawn bot để maintain target count
- **Food spawn loop** (1s, host-only): spawn food để maintain target count
- **Render loop** (requestAnimationFrame): canvas game loop 60fps

**Host Election:**
- Chạy heartbeat mỗi 2s (HOST_HEARTBEAT_INTERVAL_MS)
- Kiểm tra host còn sống mỗi 1s (HOST_CHECK_INTERVAL_MS)
- Host hết phản ứng trong 5s → client khác trở thành host mới

### 4.2 components/ — UI Layers

Các React component chỉ hiển thị + nhận user input:

- **GameHud.jsx**: Level, XP bar, leaderboard (top 5 player)
- **RoomChatBox.jsx**: Scrollable chat log (last N messages)
- **ChatInputOverlay.jsx**: Text input (Enter to send, Escape to cancel)
- **DeathOverlay.jsx**: "You died" + killer name + respawn button
- **MainMenu.jsx**: Join room selector (if not in-game)
- **EmoteWheel.jsx**: Radial emote picker (right-click hold)

### 4.3 hooks/ — Realtime Sync & Smoothing

**useGameSync.js:**
- Chạy 16ms smoothing tick độc lập
- Giữ `rawClients/rawFoodItems` (từ Firebase, authoritative)
- Giữ `smoothClients/foodItems` (interpolated/predicted, render-only)
- Gọi `useInterpolation` + `usePrediction` mỗi tick

**useNetworkSync.js:**
- Lắng nghe Firebase child_added/child_changed trên clients, food, chat
- Normalize snapshot: yêu cầu fields like `leftPunch`, `rightPunch`, `swordSwing`, `swordAngle`, `isDead`, `killerId`, `invulnerableUntil`, `updatedAt`
- Reject stale snapshots (incoming `updatedAt` phải >= current để tránh overwrite mới bằng cũ)
- Cập nhật rawClients/rawFoodItems

**useInterpolation.js:**
- Lerp position/angle của remote player từ last → current position (LERP_FACTOR = 0.3)
- Lerp combat angle với LERP_COMBAT_FACTOR = 0.35
- Local player (myId) KHÔNG nội suy (render ngay để giảm latency)

**usePrediction.js:**
- Dự đoán chuyển động remote player bằng velocity metadata (__vx, __vy, __recvTs)
- Chỉ dự đoán human player, NOT bot (bot di chuyển host-only)

### 4.4 firebase/

- **config.js**: Init Firebase app, export RTDB singleton instance `db`
- **paths.js**: `getRoomCollectionPath(roomId, collection)` → `roomId === 'default' ? collection : rooms/{roomId}/{collection}`

### 4.5 renderer/

**playerRenderer.js:**
- `drawPlayer()`: Vẽ player circle, label (name/level), color theo score
- `drawAttackCooldownUnderLabel()`: Cooldown bar dưới player name
- Punch animation (2 red points extend từ player)
- Sword swing arc (từ base angle, sweep arc = π)
- Emote bubble (floating text bubble)

**worldRenderer.js:**
- `drawGrid()`: Grid pattern 75px × 75px
- `drawFood()`: Food particle (2-4px radius)

### 4.6 simulators/

**Bot.js:**
- Bot ID: "bot-" + uuid
- Logic: Chase nearest food, collision với player = punch effect, respawn nếu chết
- Viết state bot lên Firebase mỗi loop (80ms)
- Sanitize undefined fields trước write (Bot.sanitizeBotForDb)

**Spawn.js:**
- Maintain TARGET_FOOD_COUNT (600) trong room
- Spawn mỗi FOOD_SPAWN_INTERVAL_MS (1s)
- Random position + score value (1-5 score)

### 4.7 utils/

- **combat.js**: `buildCombatHitPatches()`, `buildKillScoreDelta()`
- **foodConsumption.js**: `consumeFoodTransaction()`, atomic food eat
- **physics.js**: Collision, level/size math, sword worldPoints
- **math.js**: Angle, distance, normalization
- **hudState.js**: Build HUD state from game state

## 5. Luồng Dữ Liệu Realtime

Firebase RTDB là nguồn dữ liệu authoritative cho entity state. Dự án tách rõ dữ liệu raw và dữ liệu smooth:

```text
Firebase child listeners
  -> normalizeClientSnapshot
  -> rawClients / rawFoodItems
  -> smoothing tick mỗi 16ms
  -> smoothClients / foodItems
  -> canvas render
```

Ý nghĩa từng lớp:

- `rawClients`, `rawFoodItems`: dữ liệu gần nhất từ Firebase, dùng cho simulation, combat và quyết định gameplay.
- `smoothClients`, `foodItems`: dữ liệu render-facing, có thể được nội suy để hình ảnh mượt hơn.
- Local player được copy thẳng vào smooth state, không interpolation, để giảm input latency.

Các snapshot client được normalize trong `useNetworkSync.js`, bao gồm các trường như:

- `leftPunch`
- `rightPunch`
- `swordSwing`
- `swordAngle`
- `isDead`
- `killerId`
- `invulnerableUntil`
- `updatedAt`

Snapshot cũ bị loại bằng so sánh `updatedAt`.

## 5. Các Vòng Lặp Chính

Game tách nhiều loop độc lập để tránh trộn trách nhiệm:

| Loop | Vị trí | Tần suất | Vai trò |
|---|---|---:|---|
## 6. Các Vòng Lặp Chính

| Loop | Vị trí | Tần suất | Vai trò |
|---|---|---|---|
| **Smoothing** | useGameSync.js | 16ms | Làm mượt raw state thành smooth state |
| **Network send** | App.jsx | 50ms | Gửi state local player lên Firebase |
| **Combat/respawn** | App.jsx | 50ms | Host tính hit/kill/respawn và ghi patch lên Firebase |
| **Bot update** | App.jsx + Bot.js | 80ms | Host cập nhật bot di chuyển và combat pose |
| **Bot ensure** | App.jsx + Bot.js | 5000ms | Host đảm bảo đủ số bot mục tiêu |
| **Food spawn** | App.jsx + Spawn.js | 1000ms | Host đảm bảo đủ food mục tiêu |
| **Render** | App.jsx | requestAnimationFrame | Vẽ frame hiện tại lên Canvas 60fps |

## 7. Critical Invariants (Non-Negotiable)

❌ **NEVER:**
- Use smoothClients for hit detection (only use rawClients)
- Move combat decisions into renderer
- Replace child listeners with full-tree listeners
- Write room data to root; always use getRoomCollectionPath()
- Write undefined fields to Firebase
- Let local respawn bypass host authoritative patch
- Interpolate combat timing fields (lastPunchTime, punchStart, etc.)

✅ **ALWAYS:**
- Keep raw/smooth separation
- Use Firebase as single source of truth
- Gate hits with invulnerableUntil check
- Use child listeners (avoid overwrite)
- Use dbUpdate per-entity, not dbSet whole tree
- Sanitize bot state before write (Bot.sanitizeBotForDb)
- Request respawn via respawnRequestedAt, wait for server

## 8. Firebase Data Model

**Collection paths:**
```
clients/{clientId}        # Player state
food/{foodId}             # Food particles
chat/{messageId}          # Chat messages
host/                     # Current host heartbeat
```

**Multi-room support:**
```
rooms/{roomId}/clients
rooms/{roomId}/food
rooms/{roomId}/chat
rooms/{roomId}/host
```

## 9. Known Issues

### Issue: Food Double-Eat Race Condition
- **Current**: Local collision check + manual remove → 2 clients eat same food
- **Fix**: Firebase `runTransaction` in foodConsumption.js
- **Status**: ✅ Implemented

## 10. Development Quick Start

```bash
cd client-side
npm install
npm run dev           # Vite dev server
npm run build         # Production build
npm run lint          # ESLint
```

---

**Last Updated**: May 12, 2026  
**Project Status**: Active Development  
**Version**: 1.0 (Modular Realtime Sync Architecture)
