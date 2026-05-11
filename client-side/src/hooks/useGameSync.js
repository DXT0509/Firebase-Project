/**
 * Purpose:
 * - Orchestrate realtime sync state used by the game scene.
 *
 * Responsibilities:
 * - Keep separate raw (authoritative) and smooth (render) caches.
 * - Wire networking, prediction, and interpolation modules together.
 * - Run a fixed ~60 FPS smoothing tick independent from network cadence.
 *
 * Key concepts:
 * - `rawClients/rawFoodItems`: last server snapshots; never rendered directly.
 * - `smoothClients/foodItems`: render-facing state updated every 16ms.
 * - Local player (`myId`) is never interpolated to avoid input latency.
 */
import { useEffect, useRef, useState } from 'react';
import { useInterpolation } from './useInterpolation';
import { useNetworkSync } from './useNetworkSync';
import { usePrediction } from './usePrediction';

/**
 * Inputs:
 * - roomId: active room namespace in Realtime Database.
 * - myId: local player id used to bypass interpolation.
 *
 * Output:
 * - `{ smoothClients, foodItems, chatMessages, rawClients, rawFoodItems }`.
 *
 * Critical rule:
 * - Preserve raw/smooth separation; simulation code depends on raw snapshots.
 */
export const useGameSync = (roomId, myId) => {
  const smoothClients = useRef({});
  const foodItems = useRef({});
  const [chatMessages, setChatMessages] = useState([]);
  const rawClients = useRef({});
  const rawFoodItems = useRef({});
  const rawChatItems = useRef({});
  const tickTimerRef = useRef(0);

  const { applyPredictionToSnapshot, getPredictedTarget } = usePrediction(myId);
  const { interpolateClientState } = useInterpolation();

  useNetworkSync({
    roomId,
    myId,
    smoothClients,
    foodItems,
    rawClients,
    rawFoodItems,
    rawChatItems,
    setChatMessages,
    applyPredictionToSnapshot,
  });

  useEffect(() => {
    /**
     * Per-frame smoothing step.
     * WHY: network updates are bursty; render tick must stay visually stable.
     */
    const tick = () => {
      const now = Date.now();
      Object.entries(rawClients.current).forEach(([id, target]) => {
        if (!target) return;

        // Local player state is already immediate on this client.
        if (id === myId) {
          smoothClients.current[id] = { ...target };
          return;
        }

        const current = smoothClients.current[id];
        if (!current) {
          smoothClients.current[id] = { ...target };
          return;
        }

        if (current.isDead === true && target.isDead !== true) {
          smoothClients.current[id] = { ...target };
          return;
        }

        const displayTarget = getPredictedTarget(id, target, now);
        interpolateClientState(id, current, target, displayTarget);
      });

      Object.entries(rawFoodItems.current).forEach(([id, target]) => {
        if (!target) return;
        foodItems.current[id] = target;
      });
    };

    // Performance-sensitive loop: keep this fixed and lightweight.
    tickTimerRef.current = window.setInterval(tick, 16);

    return () => {
      window.clearInterval(tickTimerRef.current);
    };
  }, [roomId, myId, getPredictedTarget, interpolateClientState]);

  return { smoothClients, foodItems, chatMessages, rawClients, rawFoodItems };
};
