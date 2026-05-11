/**
 * Purpose:
 * - Host-side bot simulation: spawn, movement, combat, and persistence.
 *
 * Responsibilities:
 * - Keep target bot count stable in a room.
 * - Simulate bot steering toward food and combat impact resolution.
 * - Write bot/hit/food updates back to Firebase safely.
 *
 * Key concepts:
 * - Host-authoritative update model.
 * - Simulation runs on raw snapshots (not smoothed render state).
 * - All writes are room-scoped; root-path writes will desync rooms.
 */
import { ref as dbRef, get, set as dbSet, update as dbUpdate, remove as dbRemove } from 'firebase/database';
import { db } from '../firebase/config';
import { getRoomCollectionPath } from '../firebase/paths';
import {
	WORLD_SIZE,
	PUNCH_COOLDOWN,
	PUNCH_COOLDOWN_PER_LEVEL,
	TARGET_BOT_COUNT,
	BOT_SPEED,
	BOT_HIT_PUSH_Y,
	BOT_ID_PREFIX,
	RESPAWN_INVULNERABLE_MS,
	SWING_EXTEND_DURATION,
	SWING_RETURN_DURATION,
	SWING_TOTAL_DURATION,
} from '../constants/gameConfig';
import { getLevelFromScore, getSizeFromLevel } from '../utils/physics';

// Performance-sensitive: persisted between ticks to keep speed frame-rate independent.
let lastBotSimTs = 0;


/**
 * Input: bot score.
 * Output: attack cooldown in ms.
 */
const getBotAttackDelayMs = (score) => {
	const level = getLevelFromScore(score);
	return PUNCH_COOLDOWN + PUNCH_COOLDOWN_PER_LEVEL * (level - 1);
};


/** Output: random HSL bot color string. */
const randomColor = () => {
	const h = Math.floor(Math.random() * 360);
	const s = 70 + Math.random() * 20; // 70–90%
	const l = 45 + Math.random() * 15; // 45–60%
	return `hsl(${h}, ${s}%, ${l}%)`;
};

/** Input: numeric bot index. Output: stable bot id string. */
const makeBotId = (index) => `${BOT_ID_PREFIX}${index.toString().padStart(3, '0')}`;

/**
 * Inputs:
 * - clients: client map.
 * - gridSize: number of cells per axis.
 *
 * Output:
 * - `{ grid, cellSize }` occupancy information for sparse spawning.
 */
const buildOccupancyGrid = (clients, gridSize) => {
	const cellSize = WORLD_SIZE / gridSize;
	const grid = Array.from({ length: gridSize }, () =>
		Array.from({ length: gridSize }, () => 0)
	);

	Object.values(clients || {}).forEach((c) => {
		if (!c || typeof c.x !== 'number' || typeof c.y !== 'number') return;
		const cx = Math.floor(Math.max(0, Math.min(WORLD_SIZE - 1, c.x)) / cellSize);
		const cy = Math.floor(Math.max(0, Math.min(WORLD_SIZE - 1, c.y)) / cellSize);
		if (cx >= 0 && cx < gridSize && cy >= 0 && cy < gridSize) {
			grid[cy][cx] += 1;
		}
	});

	return { grid, cellSize };
};

/**
 * Inputs:
 * - grid and cellSize from occupancy map.
 *
 * Output:
 * - Spawn position in the least crowded region.
 */
const pickPositionInLeastCrowdedCell = (grid, cellSize) => {
	let minCount = Infinity;
	const candidates = [];

	for (let y = 0; y < grid.length; y++) {
		for (let x = 0; x < grid[y].length; x++) {
			const count = grid[y][x];
			if (count < minCount) {
				minCount = count;
				candidates.length = 0;
				candidates.push({ x, y });
			} else if (count === minCount) {
				candidates.push({ x, y });
			}
		}
	}

	if (!candidates.length) {
		return { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
	}

	const chosen = candidates[Math.floor(Math.random() * candidates.length)];
	const baseX = chosen.x * cellSize;
	const baseY = chosen.y * cellSize;
	const x = baseX + Math.random() * cellSize;
	const y = baseY + Math.random() * cellSize;

	// Cập nhật mật độ ngay khi chọn ô này để các bot sau tránh chồng nhau quá nhiều
	grid[chosen.y][chosen.x] += 1;

	return {
		x: Math.max(0, Math.min(WORLD_SIZE, x)),
		y: Math.max(0, Math.min(WORLD_SIZE, y)),
	};
};

/** Inputs: spawn x/y. Output: initialized bot payload for Firebase. */
const createBotPayload = (x, y) => {
	return {
		x,
		y,
		color: randomColor(),
		angle: 0,
		swordAngle: 0,
		swordSwing: 0,
		leftPunch: 0,
		rightPunch: 0,
		punchHand: 0,
		punchStart: 0,
		nextPunchHand: 0,
		lastPunchTime: 0,
		score: 0,
		respawnAt: 0,
		updatedAt: Date.now(),
		boost: false,
		lastSeen: Date.now(),
		name: 'BOT',
	};
};

/** Input: none. Output: random bot spawn location. */
const getRandomSpawnPosition = () => ({
	x: Math.random() * WORLD_SIZE,
	y: Math.random() * WORLD_SIZE,
});

/**
 * Inputs: dead bot payload and current timestamp.
 * Output: bot payload reset for respawn.
 */
const respawnBotPayload = (bot, now) => {
	const spawn = getRandomSpawnPosition();
	return {
		...bot,
		x: spawn.x,
		y: spawn.y,
		angle: Math.random() * Math.PI * 2,
		swordAngle: 0,
		swordSwing: 0,
		leftPunch: 0,
		rightPunch: 0,
		punchHand: 0,
		punchStart: 0,
		nextPunchHand: 0,
		lastPunchTime: 0,
		lastPunchHit: null,
		isDead: false,
		killerId: null,
		killExpGain: 0,
		respawnAt: 0,
		invulnerableUntil: now + RESPAWN_INVULNERABLE_MS,
		updatedAt: now,
		boost: false,
		lastSeen: now,
	};
};

/**
 * Inputs:
 * - bot state and current timestamp.
 *
 * Output:
 * - Derived punch/swing state for this tick.
 */
const getBotPunchState = (bot, now) => {
	if (!bot || bot.isDead === true || isEntityInvulnerable(bot, now)) {
		return {
			leftPunch: 0,
			rightPunch: 0,
			swordSwing: 0,
			punchHand: typeof bot?.punchHand === 'number' ? bot.punchHand : 0,
			punchStart: 0,
			nextPunchHand: typeof bot?.nextPunchHand === 'number' ? bot.nextPunchHand : 0,
			lastPunchTime: typeof bot?.lastPunchTime === 'number' ? bot.lastPunchTime : 0,
		};
	}

	let punchHand = typeof bot.punchHand === 'number' ? bot.punchHand : 0;
	let punchStart = typeof bot.punchStart === 'number' ? bot.punchStart : 0;
	let nextPunchHand = bot.nextPunchHand === 1 ? 1 : 0;
	let lastPunchTime = typeof bot.lastPunchTime === 'number' ? bot.lastPunchTime : 0;
	const botScore = typeof bot.score === 'number' ? bot.score : 0;
	const attackDelayMs = getBotAttackDelayMs(botScore);

	const isPunching = punchStart && now - punchStart < SWING_TOTAL_DURATION;
	if (!isPunching && now - lastPunchTime >= attackDelayMs) {
		punchHand = nextPunchHand;
		punchStart = now;
		lastPunchTime = now;
		nextPunchHand = nextPunchHand === 0 ? 1 : 0;
	}

	let punchProgress = 0;
	if (punchStart) {
		const elapsed = now - punchStart;
		if (elapsed <= SWING_EXTEND_DURATION) {
			punchProgress = elapsed / SWING_EXTEND_DURATION;
		} else {
			const returnElapsed = elapsed - SWING_EXTEND_DURATION;
			punchProgress = Math.max(0, 1 - returnElapsed / SWING_RETURN_DURATION);
		}
		if (elapsed >= SWING_TOTAL_DURATION) {
			punchStart = 0;
			punchProgress = 0;
		}
	}

	return {
		leftPunch: punchHand === 0 ? punchProgress : 0,
		rightPunch: punchHand === 1 ? punchProgress : 0,
		swordSwing: punchProgress,
		punchHand,
		punchStart,
		nextPunchHand,
		lastPunchTime,
	};
};

/**
 * Inputs: base bot state, facing angle, punch state.
 * Output: bot state with synchronized combat pose fields.
 */
const withBotCombatPose = (bot, angle, punchState) => {
	return {
		...bot,
		...punchState,
		swordAngle: angle,
		swordSwing: typeof punchState.swordSwing === 'number'
			? punchState.swordSwing
			: Math.max(punchState.leftPunch || 0, punchState.rightPunch || 0),
	};
};

/** Input: coordinate value. Output: value clamped to world bounds. */
const clampWorld = (value) => Math.max(0, Math.min(WORLD_SIZE, value));

/** Input: entity + timestamp. Output: whether entity is currently invulnerable. */
const isEntityInvulnerable = (entity, now) => {
	if (!entity) return false;
	const invulnerableUntil = typeof entity.invulnerableUntil === 'number' ? entity.invulnerableUntil : 0;
	return invulnerableUntil > now;
};

/**
 * Input: bot payload.
 * Output: Firebase-safe payload with undefined fields removed.
 *
 * Critical rule:
 * - Never write undefined to RTDB; it will throw and stop bot updates.
 */
const sanitizeBotForDb = (bot) => {
	const output = {};
	Object.entries(bot || {}).forEach(([key, value]) => {
		if (value === undefined) return;

		if (key === 'lastPunchHit') {
			if (!value || typeof value !== 'object') return;
			const cleanedMemo = {};
			Object.entries(value).forEach(([targetId, stamp]) => {
				if (typeof stamp === 'number' && Number.isFinite(stamp)) {
					cleanedMemo[targetId] = stamp;
				}
			});
			if (Object.keys(cleanedMemo).length > 0) {
				output.lastPunchHit = cleanedMemo;
			}
			return;
		}

		output[key] = value;
	});

	return output;
};

/**
 * Inputs:
 * - attacker and target entities.
 *
 * Output:
 * - Whether target body intersects attacker sword segment this tick.
 */
const isSwordSegmentHit = (attacker, target) => {
	if (!attacker || !target) return false;
	if (
		typeof attacker.x !== 'number' ||
		typeof attacker.y !== 'number' ||
		typeof target.x !== 'number' ||
		typeof target.y !== 'number'
	) {
		return false;
	}

	const swingProgress = Math.max(0, Math.min(1, Number(attacker.swordSwing) || 0));
	if (swingProgress <= 0) return false;

	const attackerScore = Number.isFinite(attacker.score) ? attacker.score : 0;
	const targetScore = Number.isFinite(target.score) ? target.score : 0;
	const attackerSize = getSizeFromLevel(getLevelFromScore(attackerScore));
	const targetSize = getSizeFromLevel(getLevelFromScore(targetScore));
	const swordAngle = typeof attacker.swordAngle === 'number' ? attacker.swordAngle : (typeof attacker.angle === 'number' ? attacker.angle : 0);
	const sword = getSwordWorldPoints(attacker.x, attacker.y, swordAngle, attackerSize, swingProgress, 'left');
	const distanceToBlade = getPointToSegmentDistance(
		target.x,
		target.y,
		sword.handX,
		sword.handY,
		sword.tipX,
		sword.tipY,
	);
	const targetBodyRadius = targetSize / 2;

	return distanceToBlade <= targetBodyRadius + sword.impactRadius;
};

/**
 * Input: roomId.
 * Output: none (side effect writes missing bots to Firebase).
 *
 * WHY:
 * - Keep bot population stable without overwriting full clients node.
 */
export const ensureBots = async (roomId) => {
	const clientsPath = getRoomCollectionPath(roomId, 'clients');
	const clientsRef = dbRef(db, clientsPath);
	const snap = await get(clientsRef);
	const allClients = snap.val() || {};

	// Tách người chơi thật và bot
	const botEntries = Object.entries(allClients).filter(([id]) => id.startsWith(BOT_ID_PREFIX));
	const humanEntries = Object.entries(allClients).filter(([id]) => !id.startsWith(BOT_ID_PREFIX));

	// Giữ nguyên người thật, chỉ thao tác trên bot
	const humanClients = Object.fromEntries(humanEntries);
	const currentBots = Object.fromEntries(botEntries);
	const currentBotCount = botEntries.length;

	if (currentBotCount >= TARGET_BOT_COUNT) {
		// Đã đủ hoặc dư bot: không cần ghi lại toàn bộ node clients để tránh overwrite lớn
		return;
	}

	const need = TARGET_BOT_COUNT - currentBotCount;

	// Dùng occupancy grid để tìm vùng ít người nhất
	const GRID_SIZE = 10; // 10x10 ô trên map 5000x5000
	const { grid, cellSize } = buildOccupancyGrid(allClients, GRID_SIZE);

	const updates = {};
	for (let i = 0; i < need; i++) {
		const { x, y } = pickPositionInLeastCrowdedCell(grid, cellSize);
		const botIndex = currentBotCount + i;
		const botId = makeBotId(botIndex);
		updates[botId] = createBotPayload(x, y);
	}

	// Ghi từng bot mới theo per-entity path để giảm kích thước mỗi lần ghi
	await Promise.all(
		Object.entries(updates).map(([id, payload]) =>
			dbSet(dbRef(db, `${clientsPath}/${id}`), payload),
		),
	);
};

/** Input: bot + food map. Output: nearest `{ id, food }` or null. */
const findNearestFood = (bot, foods) => {
	let nearest = null;
	let nearestId = null;
	let nearestDistSq = Infinity;

	Object.entries(foods || {}).forEach(([id, food]) => {
		if (!food || typeof food.x !== 'number' || typeof food.y !== 'number') return;
		const dx = food.x - bot.x;
		const dy = food.y - bot.y;
		const d2 = dx * dx + dy * dy;
		if (d2 < nearestDistSq) {
			nearestDistSq = d2;
			nearest = food;
			nearestId = id;
		}
	});

	if (!nearest) return null;
	return { id: nearestId, food: nearest };
};

/**
 * Inputs:
 * - Optional `allClientsOverride` and `allFoodOverride` snapshots.
 * - roomId used for room-scoped writes.
 *
 * Output:
 * - None (side effects update bot state and consume eaten food).
 *
 * Critical rules:
 * - Do not feed smoothed client data here; simulation requires authoritative snapshots.
 * - Keep batched writes per entity to avoid large full-node overwrites.
 */
export const updateBotsTowardFood = async (allClientsOverride, allFoodOverride, roomId) => {
	const clientsPath = getRoomCollectionPath(roomId, 'clients');
	const foodPath = getRoomCollectionPath(roomId, 'food');
	const clientsRef = dbRef(db, clientsPath);
	const foodRef = dbRef(db, foodPath);

	let allClients;
	let allFood;

	if (allClientsOverride) {
		allClients = allClientsOverride;
	} else {
		const clientsSnap = await get(clientsRef);
		allClients = clientsSnap.val() || {};
	}

	if (allFoodOverride) {
		allFood = allFoodOverride;
	} else {
		const foodSnap = await get(foodRef);
		allFood = foodSnap.val() || {};
	}

	const botEntries = Object.entries(allClients).filter(([id]) => id.startsWith(BOT_ID_PREFIX));
	const botClients = Object.fromEntries(botEntries);

	if (!botEntries.length) {
		lastBotSimTs = 0;
		return;
	}

	const now = Date.now();
	if (!lastBotSimTs) lastBotSimTs = now;
	const simDt = Math.max(0.016, (now - lastBotSimTs) / 1000); // tối thiểu ~1 frame
	lastBotSimTs = now;
	const botStep = BOT_SPEED * simDt;
	const updatedBots = { ...botClients };
	const foodsToRemove = [];
	const hasFood = Object.keys(allFood).length > 0;

	Object.entries(botClients).forEach(([id, bot]) => {
		if (!bot || bot.isDead !== true) return;
		const respawnAt = typeof bot.respawnAt === 'number' ? bot.respawnAt : 0;
		console.log('[bot-respawn-check]', id, { now, respawnAt, isDead: bot.isDead });
		if (!respawnAt || now < respawnAt) return;
		console.log('[bot-respawn]', id, { now, respawnAt });
		updatedBots[id] = respawnBotPayload(bot, now);
	});

	if (!hasFood) {
		// Không có food thì vẫn di chuyển nhẹ + spam punch theo cooldown player
		Object.entries(botClients).forEach(([id, bot]) => {
			const botState = updatedBots[id] || bot;
			if (!botState || botState.isDead === true) return;
			const angle = Math.random() * Math.PI * 2;
			const nx = Math.max(0, Math.min(WORLD_SIZE, botState.x + Math.cos(angle) * botStep));
			const ny = Math.max(0, Math.min(WORLD_SIZE, botState.y + Math.sin(angle) * botStep));
			const punchState = getBotPunchState(botState, now);

			updatedBots[id] = withBotCombatPose({
				...botState,
				x: nx,
				y: ny,
				angle,
				lastSeen: now,
				updatedAt: now,
			}, angle, punchState);
		});
	}

	Object.entries(botClients).forEach(([id, bot]) => {
		const botState = updatedBots[id] || bot;
		if (!botState || typeof botState.x !== 'number' || typeof botState.y !== 'number') return;
		if (botState.isDead === true) return;
		if (!hasFood) return;
		const nearest = findNearestFood(botState, allFood);
		if (!nearest) {
			// fallback: di chuyển random
			const angle = Math.random() * Math.PI * 2;
			const nx = botState.x + Math.cos(angle) * botStep;
			const ny = botState.y + Math.sin(angle) * botStep;
			const punchState = getBotPunchState(botState, now);

			updatedBots[id] = withBotCombatPose({
				...botState,
				x: nx,
				y: ny,
				angle,
				lastSeen: now,
				updatedAt: now,
			}, angle, punchState);
			return;
		}

		const { id: foodId, food: targetFood } = nearest;
		const dx = targetFood.x - botState.x;
		const dy = targetFood.y - botState.y;
		const dist = Math.hypot(dx, dy);
		const punchState = getBotPunchState(botState, now);
		if (!dist) {
			// Tránh đứng im: khi trùng đúng tọa độ food thì vẫn random nhẹ
			const angle = Math.random() * Math.PI * 2;
			const nx = clampWorld(botState.x + Math.cos(angle) * botStep);
			const ny = clampWorld(botState.y + Math.sin(angle) * botStep);
			updatedBots[id] = withBotCombatPose({
				...botState,
				x: nx,
				y: ny,
				angle,
				lastSeen: now,
				updatedAt: now,
			}, angle, punchState);
			return;
		}

		const step = Math.min(botStep, dist); // không overshoot
		let nx = botState.x + (dx / dist) * step;
		let ny = botState.y + (dy / dist) * step;
		nx = clampWorld(nx);
		ny = clampWorld(ny);
		const angle = Math.atan2(dy, dx);

		// Nếu sau bước di chuyển này bot gần food đủ để coi như ăn
		const willReachFood = dist <= botStep + 2;
		let newScore = typeof botState.score === 'number' ? botState.score : 0;
		if (willReachFood && foodId && allFood[foodId]) {
			const size = allFood[foodId].size || 1;
			if (size === 1) newScore += 8;
			else if (size === 2) newScore += 19;
			else newScore += 40;
			// Xoá food này khỏi pool để các bot khác chọn mục tiêu mới
			const { [foodId]: _removed, ...rest } = allFood;
			allFood = rest;
			foodsToRemove.push(foodId);
		}

		updatedBots[id] = withBotCombatPose({
			...botState,
			x: nx,
			y: ny,
			angle,
			lastSeen: now,
			updatedAt: now,
			score: newScore,
		}, angle, punchState);
	});

	// Per-entity cập nhật cho bot + xoá food bị ăn, tránh overwrite toàn bộ node
	const botWrites = Object.entries(updatedBots).map(([id, bot]) =>
		dbSet(dbRef(db, `${clientsPath}/${id}`), sanitizeBotForDb(bot)),
	);

	const foodDeletes = foodsToRemove.map((foodId) =>
		foodId ? dbRemove(dbRef(db, `${foodPath}/${foodId}`)) : Promise.resolve(),
	);

	await Promise.all([...botWrites, ...foodDeletes]);
};

// Tuỳ theo cách bạn dùng:
// - Có thể import ensureBots/updateBotsTowardFood vào một script admin hoặc server mô phỏng,
// - Và gọi ensureBots() lúc khởi tạo, updateBotsTowardFood() định kỳ để bot luôn
//   spawn đủ 100 con và tự di chuyển kiếm food gần nhất.
