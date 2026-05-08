# AGENTS.md

Scope: guidance for AI coding agents working on this realtime multiplayer client (React + Firebase RTDB + canvas).

## Authoritative Data Flow (must preserve)
- Firebase RTDB is the authority for entity state (clients/food/chat).
- Ingest path is: Firebase child listeners -> normalizeClientSnapshot -> rawClients/rawFoodItems -> smoothing tick -> smoothClients/foodItems -> canvas render.
- Keep raw vs smooth separation:
  - rawClients/rawFoodItems = authoritative simulation/combat input.
  - smoothClients/foodItems = render-facing state only.
- Local player (myId) is copied directly into smooth state (no interpolation) to minimize input latency.

## Snapshot Normalization Rules
- Client snapshots are normalized in hooks/useNetworkSync.js before entering raw cache.
- Required normalized fields include leftPunch/rightPunch/swordSwing/swordAngle and server-driven death fields (isDead, killerId, invulnerableUntil, updatedAt).
- Reject stale snapshots using updatedAt ordering (incoming must be >= current).

## Loop System (do not merge loops)
- Smoothing loop: setInterval(..., 16) in hooks/useGameSync.js.
- Network send loop: setInterval(..., 50) in App.jsx.
- Authoritative combat/respawn loop: setInterval(..., 50) in App.jsx (host writes patches to Firebase).
- Bot simulation loop: BOT_UPDATE_INTERVAL_MS (40ms), host-only.
- Bot ensure loop: BOT_ENSURE_INTERVAL_MS (5000ms), host-only.
- Food spawn loop: FOOD_SPAWN_INTERVAL_MS (1000ms), host-only.
- Render loop: requestAnimationFrame(gameLoop) in App.jsx.

## Interpolation + Prediction Contract
- Prediction is remote-player only and excludes bots (hooks/usePrediction.js).
- Prediction metadata (__vx, __vy, __recvTs) is attached at ingest time.
- Interpolation mutates smooth state in place (hooks/useInterpolation.js).
- Never interpolate authoritative timing/combat stamps used by hit logic (lastPunchTime, punchStart, etc. are copied, not lerped).

## Critical Invariants (non-negotiable)
- Rendering must NEVER decide game outcomes.
- Combat hit detection must use raw authoritative state only (utils/combat.js).
- Smooth state is render-only and can be visually ahead/behind.
- Firebase updates can and should override local assumptions (death, respawn, invulnerability, score reconciliation).

## Gameplay Systems You Must Respect
- Movement: local immediate movement + server reconciliation in App.jsx.
- Combat: host computes hit patches via buildCombatHitPatches(rawClients, now) then dbUpdate per entity.
- Respawn:
  - Humans: host-only processAuthoritativeRespawns() after RESPAWN_DELAY_MS and respawnRequestedAt.
  - Bots: Bot.js handles respawnAt and applies invulnerableUntil after respawn.
- Invulnerability: always gate hits using invulnerableUntil checks.

## Common Project Pitfalls (avoid these)
- DO NOT use smoothClients for hit detection or kill resolution.
- DO NOT move combat decisions into renderer functions.
- DO NOT replace child listeners with full-tree listeners (performance + overwrite risk).
- DO NOT write room data to root paths when roomId is non-default; always use getRoomCollectionPath(roomId, collection).
- DO NOT dbSet whole clients tree for combat/respawn updates; prefer per-entity dbUpdate patches.
- DO NOT write undefined fields to RTDB (Bot.js sanitizeBotForDb exists for this).
- DO NOT let local respawn logic bypass authoritative host updates; request via respawnRequestedAt and wait for server patch.

## File Ownership Map
- hooks/useGameSync.js: orchestrates raw/smooth caches + 16ms smoothing tick.
- hooks/useNetworkSync.js: Firebase listeners, normalization, raw cache ingest.
- hooks/useInterpolation.js + hooks/usePrediction.js: visual smoothing/prediction only.
- utils/combat.js: authoritative sword hit patch generation.
- simulators/Bot.js + simulators/Spawn.js: host simulation writes (bots/food).
- renderer/playerRenderer.js + renderer/worldRenderer.js: visual layer only (no authority).
- firebase/config.js + firebase/paths.js: RTDB singleton + room-safe path routing.
