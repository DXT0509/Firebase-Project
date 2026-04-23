/**
 * Purpose:
 * - Define emote catalog and shared display timing.
 *
 * Responsibilities:
 * - Expose selectable emote metadata for UI and renderer.
 *
 * Key concepts:
 * - IDs are protocol-facing; changing them breaks persisted emote values.
 */
export const EMOTE_DURATION_MS = 2000;

export const EMOTE_OPTIONS = [
  { id: 'like', label: 'Like', icon: '👍' },
  { id: 'smile', label: 'Cười', icon: '😄' },
  { id: 'laugh', label: 'Cười ra nước mắt', icon: '😂' },
  { id: 'cry', label: 'Khóc', icon: '😭' },
  { id: 'gg', label: 'GG', icon: 'GG' },
  { id: 'tongue', label: 'Lêu lêu', icon: '😛' },
];

/** Input: emote id string. Output: matching emote object or null. */
export const getEmoteById = (id) => EMOTE_OPTIONS.find((item) => item.id === id) || null;
