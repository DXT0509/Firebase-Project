import { DEFAULT_ROOM_ID } from '../constants/gameConfig';

export const getRoomCollectionPath = (roomId, collection) => {
  if (!roomId || roomId === DEFAULT_ROOM_ID) return collection;
  return `rooms/${roomId}/${collection}`;
};
