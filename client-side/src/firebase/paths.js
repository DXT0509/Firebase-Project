/**
 * Purpose:
 * - Build room-aware collection paths for Realtime Database.
 *
 * Responsibilities:
 * - Route default room to root collections for backward compatibility.
 * - Route non-default rooms under `rooms/{roomId}` namespace.
 */
import { DEFAULT_ROOM_ID } from '../constants/gameConfig';

/**
 * Inputs:
 * - roomId: target room identifier.
 * - collection: base collection name (e.g., clients, food, chat).
 *
 * Output:
 * - Correct room-scoped collection path.
 */
export const getRoomCollectionPath = (roomId, collection) => {
  if (!roomId || roomId === DEFAULT_ROOM_ID) return collection;
  return `rooms/${roomId}/${collection}`;
};
