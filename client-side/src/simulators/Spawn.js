/**
 * Purpose:
 * - Maintain target food population per room.
 *
 * Responsibilities:
 * - Generate food payloads with randomized position/size/color.
 * - Keep total count at `TARGET_FOOD_COUNT`.
 *
 * Key concepts:
 * - Spawn writes are room-scoped.
 * - Existing food must be preserved when adding new items.
 */
import { ref as dbRef, set as dbSet, get } from 'firebase/database';
import { db } from '../firebase/config';
import { TARGET_FOOD_COUNT, WORLD_SIZE } from '../constants/gameConfig';
import { getRoomCollectionPath } from '../firebase/paths';

/** Output: random HSL color string for food marker variety. */
const randomColor = () => {
	const h = Math.floor(Math.random() * 360);
	const s = 70 + Math.random() * 20; // 70–90%
	const l = 45 + Math.random() * 15; // 45–60%
	return `hsl(${h}, ${s}%, ${l}%)`;
};

/** Output: weighted random food size (1, 2, or 3). */
const randomSize = () => {
	const r = Math.random();
	if (r < 0.5) return 1;   // nhiều food nhỏ
	if (r < 0.85) return 2;  // trung bình
	return 3;                // ít food lớn
};

/**
 * Inputs: grid cell coordinates + cell size.
 * Output: random world-space position clamped inside map bounds.
 */
const randomPositionInCell = (cellX, cellY, cellSize) => {
	const x = cellX * cellSize + Math.random() * cellSize;
	const y = cellY * cellSize + Math.random() * cellSize;
	return {
		x: Math.max(0, Math.min(WORLD_SIZE, x)),
		y: Math.max(0, Math.min(WORLD_SIZE, y)),
	};
};

/**
 * Input: roomId.
 * Output: none (side effect writes missing food entries).
 *
 * Critical rule:
 * - Preserve existing food entries when appending new ones.
 */
export const spawnFood = async (roomId) => {
	const foodRef = dbRef(db, getRoomCollectionPath(roomId, 'food'));

	// Đọc danh sách food hiện tại
	const snap = await get(foodRef);
	const existing = snap.val() || {};
	const currentCount = Object.keys(existing).length;

	if (currentCount >= TARGET_FOOD_COUNT) return; // Đã đủ rồi

	const need = TARGET_FOOD_COUNT - currentCount;

	// Chia map thành lưới để phân bổ đều
	const gridSize = Math.ceil(Math.sqrt(need));
	const cellSize = WORLD_SIZE / gridSize;

	const updates = {};
	let created = 0;

	for (let gx = 0; gx < gridSize && created < need; gx++) {
		for (let gy = 0; gy < gridSize && created < need; gy++) {
			const { x, y } = randomPositionInCell(gx, gy, cellSize);
			const size = randomSize();
			const color = randomColor();

			const id = crypto.randomUUID();
			updates[id] = { x, y, size, color };
			created++;
		}
	}

	if (created > 0) {
		// Ghi thêm các food mới vào Firebase, giữ lại food cũ
		await dbSet(foodRef, {
			...existing,
			...updates,
		});
	}
};

// Tuỳ cách bạn muốn dùng:
// - Có thể import spawnFood vào server mô phỏng hoặc client admin
// - Và gọi spawnFood định kỳ (ví dụ setInterval) để đảm bảo luôn đủ 600 food

