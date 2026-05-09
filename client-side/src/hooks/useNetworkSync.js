/**
 * Purpose:
 * - Subscribe to Firebase room collections (clients, food, chat).
 *
 * Responsibilities:
 * - Normalize incoming client snapshots.
 * - Update raw caches and bootstrap smooth cache entries.
 * - Maintain trimmed chat message list for UI rendering.
 *
 * Key concepts:
 * - This module does no interpolation; it only ingests network data.
 * - Prediction metadata is attached at ingest time.
 */
import { useEffect } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, ref as dbRef } from 'firebase/database';
import { db } from '../firebase/config';
import { getRoomCollectionPath } from '../firebase/paths';

/**
 * Input:
 * - Raw client snapshot from Firebase.
 *
 * Output:
 * - Snapshot with guaranteed combat/emote fields.
 *
 * WHY:
 * - Interpolation code must avoid branching on missing fields every frame.
 */
const normalizeClientSnapshot = (data) => {
  if (!data) return null;
  const leftPunch = typeof data.leftPunch === 'number' ? data.leftPunch : 0;
  const rightPunch = typeof data.rightPunch === 'number' ? data.rightPunch : 0;
  const swordSwing =
    typeof data.swordSwing === 'number'
      ? data.swordSwing
      : Math.max(leftPunch, rightPunch);

  return {
    ...data,
    leftPunch,
    rightPunch,
    swordSwing,
    swordAngle: typeof data.swordAngle === 'number' ? data.swordAngle : data.angle || 0,
    activeEmote: typeof data.activeEmote === 'string' && data.activeEmote.length > 0 ? data.activeEmote : null,
    emoteUntil: typeof data.emoteUntil === 'number' ? data.emoteUntil : 0,
    emoteAt: typeof data.emoteAt === 'number' ? data.emoteAt : 0,
    // Server-driven death/respawn state. Never derive these client-side.
    isDead: data.isDead === true,
    killerId: typeof data.killerId === 'string' && data.killerId.length > 0 ? data.killerId : null,
    invulnerableUntil: typeof data.invulnerableUntil === 'number' ? data.invulnerableUntil : 0,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
};

/**
 * Inputs:
 * - current: existing cached client state.
 * - incoming: latest normalized snapshot.
 *
 * Output:
 * - Whether incoming state is newer or equally fresh.
 */
const shouldAcceptClientSnapshot = (current, incoming) => {
  const currentUpdatedAt = typeof current?.updatedAt === 'number' ? current.updatedAt : 0;
  const incomingUpdatedAt = typeof incoming?.updatedAt === 'number' ? incoming.updatedAt : 0;
  return incomingUpdatedAt >= currentUpdatedAt;
};

/**
 * Inputs:
 * - Room and local id context.
 * - Mutable refs for raw/smooth caches.
 * - `applyPredictionToSnapshot` to enrich incoming client snapshots.
 *
 * Output:
 * - None; side effects are Firebase subscriptions and cache updates.
 *
 * Critical rule:
 * - Keep listeners child-based; switching to full-tree listeners can regress performance.
 */
export const useNetworkSync = ({
  roomId,
  myId,
  smoothClients,
  foodItems,
  rawClients,
  rawFoodItems,
  rawChatItems,
  setChatMessages,
  applyPredictionToSnapshot,
}) => {
  useEffect(() => {
    const clientsPath = getRoomCollectionPath(roomId, 'clients');
    const foodPath = getRoomCollectionPath(roomId, 'food');
    const chatPath = getRoomCollectionPath(roomId, 'chat');
    const clientsRef = dbRef(db, clientsPath);
    const foodRef = dbRef(db, foodPath);
    const chatRef = dbRef(db, chatPath);

    /**
     * Inputs: none.
     * Output: updates chat state with newest 20 valid messages.
     */
    const refreshChatMessages = () => {
      const sorted = Object.entries(rawChatItems.current)
        .map(([id, msg]) => ({ id, ...msg }))
        .filter((msg) => typeof msg.text === 'string' && msg.text.trim().length > 0)
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setChatMessages(sorted.slice(-20));
    };

    /**
     * Inputs:
     * - id: client key.
     * - data: raw Firebase value for that key.
     *
     * Output:
     * - Mutates raw and smooth client caches.
     */
    const upsertClient = (id, data) => {
      if (!data) return;
      const normalized = normalizeClientSnapshot(data);
      const previous = rawClients.current[id];
      const predictedSnapshot = applyPredictionToSnapshot(id, normalized, previous);

      const rawCurrent = rawClients.current[id];
      if (rawCurrent && !shouldAcceptClientSnapshot(rawCurrent, predictedSnapshot)) {
        return;
      }

      rawClients.current[id] = predictedSnapshot;

      // Emote fields are copied immediately so overlays stay responsive.
      const existing = smoothClients.current[id];
      if (existing && id !== myId) {
        if (!shouldAcceptClientSnapshot(existing, predictedSnapshot)) {
          return;
        }
        existing.activeEmote = predictedSnapshot.activeEmote;
        existing.emoteUntil = predictedSnapshot.emoteUntil;
        existing.emoteAt = predictedSnapshot.emoteAt;
        existing.isDead = predictedSnapshot.isDead;
        existing.killerId = predictedSnapshot.killerId;
        existing.invulnerableUntil = predictedSnapshot.invulnerableUntil;
        existing.updatedAt = predictedSnapshot.updatedAt;
      }

      if (id === myId || !smoothClients.current[id]) {
        smoothClients.current[id] = { ...predictedSnapshot };
      }
    };

    /** Inputs: id of removed client. Output: removes both raw and smooth cache entries. */
    const removeClient = (id) => {
      delete rawClients.current[id];
      delete smoothClients.current[id];
    };

    /** Inputs: food id + payload. Output: updates raw and render food caches. */
    const upsertFood = (id, data) => {
      if (!data) return;
      rawFoodItems.current[id] = data;
      foodItems.current[id] = data;
    };

    /** Inputs: food id. Output: removes food from both raw and render caches. */
    const removeFood = (id) => {
      delete rawFoodItems.current[id];
      delete foodItems.current[id];
    };

    /** Inputs: chat id + payload. Output: appends/updates chat cache then refreshes list. */
    const upsertChat = (id, data) => {
      if (!data) return;
      rawChatItems.current[id] = data;
      refreshChatMessages();
    };

    /** Inputs: chat id. Output: removes chat entry then refreshes list. */
    const removeChat = (id) => {
      delete rawChatItems.current[id];
      refreshChatMessages();
    };

    const unsubscribeClientAdded = onChildAdded(clientsRef, (snap) => {
      upsertClient(snap.key, snap.val());
    });

    const unsubscribeClientChanged = onChildChanged(clientsRef, (snap) => {
      upsertClient(snap.key, snap.val());
    });

    const unsubscribeClientRemoved = onChildRemoved(clientsRef, (snap) => {
      removeClient(snap.key);
    });

    const unsubscribeFoodAdded = onChildAdded(foodRef, (snap) => {
      upsertFood(snap.key, snap.val());
    });

    const unsubscribeFoodChanged = onChildChanged(foodRef, (snap) => {
      upsertFood(snap.key, snap.val());
    });

    const unsubscribeFoodRemoved = onChildRemoved(foodRef, (snap) => {
      removeFood(snap.key);
    });

    const unsubscribeChatAdded = onChildAdded(chatRef, (snap) => {
      upsertChat(snap.key, snap.val());
    });

    const unsubscribeChatChanged = onChildChanged(chatRef, (snap) => {
      upsertChat(snap.key, snap.val());
    });

    const unsubscribeChatRemoved = onChildRemoved(chatRef, (snap) => {
      removeChat(snap.key);
    });

    // Keep all unsubscribe callbacks explicit to avoid listener leaks on room switch.
    return () => {
      unsubscribeClientAdded();
      unsubscribeClientChanged();
      unsubscribeClientRemoved();
      unsubscribeFoodAdded();
      unsubscribeFoodChanged();
      unsubscribeFoodRemoved();
      unsubscribeChatAdded();
      unsubscribeChatChanged();
      unsubscribeChatRemoved();
    };
  }, [roomId, myId, applyPredictionToSnapshot, smoothClients, foodItems, rawClients, rawFoodItems, rawChatItems, setChatMessages]);
};
