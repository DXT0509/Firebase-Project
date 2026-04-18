import { useEffect, useRef } from 'react';
import { onChildAdded, onChildChanged, onChildRemoved, ref as dbRef } from 'firebase/database';
import { db } from '../firebase/config';
import { LERP_COMBAT_FACTOR, LERP_FACTOR } from '../constants/gameConfig';
import { getRoomCollectionPath } from '../firebase/paths';
import { lerp, normalizeAngle } from '../utils/math';

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
  };
};

export const useGameSync = (roomId, myId) => {
  const smoothClients = useRef({});
  const foodItems = useRef({});
  const chatMessages = useRef([]);
  const rawClients = useRef({});
  const rawFoodItems = useRef({});
  const rawChatItems = useRef({});
  const rafRef = useRef(0);

  useEffect(() => {
    const clientsPath = getRoomCollectionPath(roomId, 'clients');
    const foodPath = getRoomCollectionPath(roomId, 'food');
    const chatPath = getRoomCollectionPath(roomId, 'chat');
    const clientsRef = dbRef(db, clientsPath);
    const foodRef = dbRef(db, foodPath);
    const chatRef = dbRef(db, chatPath);

    const refreshChatMessages = () => {
      const sorted = Object.entries(rawChatItems.current)
        .map(([id, msg]) => ({ id, ...msg }))
        .filter((msg) => typeof msg.text === 'string' && msg.text.trim().length > 0)
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      chatMessages.current = sorted.slice(-20);
    };

    const upsertClient = (id, data) => {
      if (!data) return;
      const normalized = normalizeClientSnapshot(data);
      rawClients.current[id] = normalized;
      if (id === myId || !smoothClients.current[id]) {
        smoothClients.current[id] = { ...normalized };
      }
    };

    const removeClient = (id) => {
      delete rawClients.current[id];
      delete smoothClients.current[id];
    };

    const upsertFood = (id, data) => {
      if (!data) return;
      rawFoodItems.current[id] = data;
      foodItems.current[id] = data;
    };

    const removeFood = (id) => {
      delete rawFoodItems.current[id];
      delete foodItems.current[id];
    };

    const upsertChat = (id, data) => {
      if (!data) return;
      rawChatItems.current[id] = data;
      refreshChatMessages();
    };

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

    const tick = () => {
      Object.entries(rawClients.current).forEach(([id, target]) => {
        if (!target) return;

        if (id === myId) {
          smoothClients.current[id] = { ...target };
          return;
        }

        const current = smoothClients.current[id];
        if (!current) {
          smoothClients.current[id] = { ...target };
          return;
        }

        current.x = lerp(current.x ?? target.x, target.x, LERP_FACTOR);
        current.y = lerp(current.y ?? target.y, target.y, LERP_FACTOR);
        current.angle = (current.angle ?? target.angle ?? 0) +
          normalizeAngle((target.angle ?? 0) - (current.angle ?? target.angle ?? 0)) * LERP_FACTOR;

        const targetSwordAngle = typeof target.swordAngle === 'number' ? target.swordAngle : (target.angle || 0);
        current.swordAngle = (current.swordAngle ?? targetSwordAngle) +
          normalizeAngle(targetSwordAngle - (current.swordAngle ?? targetSwordAngle)) * LERP_FACTOR;

        current.leftPunch = lerp(current.leftPunch ?? 0, typeof target.leftPunch === 'number' ? target.leftPunch : 0, LERP_COMBAT_FACTOR);
        current.rightPunch = lerp(current.rightPunch ?? 0, typeof target.rightPunch === 'number' ? target.rightPunch : 0, LERP_COMBAT_FACTOR);
        current.swordSwing = lerp(
          current.swordSwing ?? 0,
          typeof target.swordSwing === 'number' ? target.swordSwing : Math.max(target.leftPunch || 0, target.rightPunch || 0),
          LERP_COMBAT_FACTOR,
        );

        // Keep authoritative combat timing fields in sync (host bot logic depends on these).
        current.punchHand = target.punchHand;
        current.punchStart = target.punchStart;
        current.nextPunchHand = target.nextPunchHand;
        current.lastPunchTime = target.lastPunchTime;
        current.lastPunchHit = target.lastPunchHit;
        current.color = target.color;
        current.score = target.score;
        current.boost = target.boost;
        current.name = target.name;
        current.lastSeen = target.lastSeen;
      });

      Object.entries(rawFoodItems.current).forEach(([id, target]) => {
        if (!target) return;
        foodItems.current[id] = target;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

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
      cancelAnimationFrame(rafRef.current);
    };
  }, [roomId, myId]);

  return { smoothClients, foodItems, chatMessages };
};
