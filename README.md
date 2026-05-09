<<<<<<< HEAD
## This project is in progress at branch DaoXuanThao
=======
# Firebase Realtime Project ⚡🔥

Đây là dự án frontend sử dụng Firebase Realtime Database để xây dựng trải nghiệm realtime multiplayer trên nền React và Canvas.

Project được thiết kế theo hướng module hóa rõ ràng, tối ưu cho việc mở rộng tính năng theo thời gian.

## 🎯 Giới Thiệu

- Loại dự án: **Firebase Realtime Multiplayer Client**
- Nền tảng: **Web app với React + Canvas**
- Mục tiêu kỹ thuật: **Realtime sync mượt, kiến trúc sạch, dễ scale theo room**

## 🧱 Công Nghệ Sử Dụng

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | React + Vite | UI/HUD, vòng đời app, hiệu năng dev nhanh |
| Realtime Backend | Firebase Realtime Database | Đồng bộ player, food, chat theo thời gian thực |
| Rendering | HTML5 Canvas API | Vẽ world/player/combat với FPS cao |

## 🏗️ Kiến Trúc Dự Án (Module Hóa Chuyên Nghiệp)

Kiến trúc được tách theo domain chức năng, thay vì dồn toàn bộ vào một file monolithic.

### 1) Phân lớp theo trách nhiệm

| Layer | Thư mục | Trách nhiệm |
|---|---|---|
| UI Layer | `src/components` | HUD, leaderboard, chat box, chat input overlay |
| Realtime Sync Layer | `src/hooks`, `src/firebase` | Subscribe Firebase theo node con, smoothing state, room path abstraction |
| Simulation Layer | `src/simulators` | Spawn entity, bot AI, host-only simulation tick |
| Render Layer | `src/renderer` | Tách renderer world và renderer player/combat |
| Core Rule Layer | `src/constants`, `src/utils` | Config, math, physics, HUD state builder |

### 2) Cấu trúc thư mục chính

```text
src/
	components/        # UI module (HUD, Chat, Overlay)
	constants/         # Hằng số realtime (tick, speed, xp table, world size)
	firebase/          # Firebase init + room paths
	hooks/             # useGameSync: realtime listeners + interpolation
	renderer/          # Vẽ world/grid/food + vẽ player/combat
	simulators/        # Bot AI + spawn logic
	utils/             # Math, physics, hud state
	App.jsx            # Orchestrator: game loop + input + render + networking
```

### 3) So sánh kiến trúc: Monolithic vs Modular

| Tiêu chí | Monolithic realtime file | Firebase Project (Modular) |
|---|---|---|
| Bảo trì | Khó đọc khi project lớn | Dễ đọc theo domain |
| Mở rộng tính năng | Dễ phát sinh side-effect | Mở rộng theo module độc lập |
| Tối ưu realtime | Khó tách luồng sync/render | Tách rõ sync, simulation, render |
| Khả năng scale room | Đòi refactor nhiều | Đã có room path abstraction |
| Onboarding dev mới | Mất thời gian hiểu luồng | Nhanh nhờ phân lớp rõ ràng |

## ✨ Tính Năng Nổi Bật

### 🧬 Hệ thống level theo score
- XP table nhiều mốc cấp độ.
- Nhân vật tăng kích thước theo level.
- Attack cooldown thay đổi theo level, tạo meta combat rõ rệt.

### 🤖 Bot AI thông minh
- Duy trì số lượng bot mục tiêu tự động.
- Bot ưu tiên truy đuổi food gần nhất.
- Có combat state riêng (swing/punch timing) và va chạm dạng segment hit.

### ⚡ Di chuyển mượt mà 60fps
- Render bằng Canvas loop.
- Dữ liệu remote player được nội suy (lerp) để giảm giật.
- Networking tick tách riêng để cân bằng realtime và băng thông.

### 🏠 Hệ thống phòng (Room) hỗ trợ mở rộng
- Có abstraction cho path theo room (`rooms/{roomId}/...`).
- Dễ mở rộng thành nhiều phòng độc lập cho player/food/chat.
- Sẵn sàng cho hướng scale theo mode hoặc matchmaking.

## 🔄 Luồng Realtime Mẫu

```text
Input người chơi
	-> Cập nhật local state
	-> Gửi payload định kỳ lên Firebase
	-> Client khác nhận event child_added/changed
	-> useGameSync nội suy vị trí/góc/combat
	-> Renderer vẽ khung hình mới trên Canvas
```

## 🚀 Hướng Dẫn Cài Đặt

### 1) Cài dependencies

```bash
npm install
```

### 2) Chạy môi trường development

```bash
npm run dev
```

Sau khi chạy, mở URL Vite hiển thị trong terminal để truy cập ứng dụng.

## 📌 Ghi Chú Kỹ Thuật

- Project ưu tiên realtime synchronization và khả năng mở rộng theo module.
- Firebase Realtime Database đang đóng vai trò event/state bus cho các entity chính.
- Kiến trúc hiện tại phù hợp để tiếp tục tách host simulation ra service riêng trong các giai đoạn scale tiếp theo.

## 🧠 Định Hướng Mở Rộng

- Multi-room UI đầy đủ (tạo/join/list room).
- Anti-cheat và authoritative simulation rõ ràng hơn.
- Matchmaking và ranked mode.
- Tối ưu network payload và snapshot reconciliation.

---

**Firebase Realtime Project** là nền tảng được tổ chức tốt để phát triển các tính năng realtime multiplayer trên web. 🚀
>>>>>>> 4f910e14072e31ec058536216396ae9ea84cde27
