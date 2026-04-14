import {
  ZR_KEY_UP,
  ZR_KEY_DOWN,
  ZR_KEY_HOME,
  ZR_KEY_END,
  ZR_KEY_PAGE_UP,
  ZR_KEY_PAGE_DOWN,
  PAGE_SIZE,
} from './key-codes.js';

export function calculateNextIndex(
  currentIndex: number,
  emailCount: number,
  key: number,
): number {
  if (key === ZR_KEY_UP) return Math.max(0, currentIndex - 1);
  if (key === ZR_KEY_DOWN) return Math.min(emailCount - 1, currentIndex + 1);
  if (key === ZR_KEY_HOME) return 0;
  if (key === ZR_KEY_END) return emailCount - 1;
  if (key === ZR_KEY_PAGE_UP) return Math.max(0, currentIndex - PAGE_SIZE);
  if (key === ZR_KEY_PAGE_DOWN)
    return Math.min(emailCount - 1, currentIndex + PAGE_SIZE);
  return currentIndex;
}
