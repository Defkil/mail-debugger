import { calculateNextIndex } from './navigation';
import {
  ZR_KEY_UP,
  ZR_KEY_DOWN,
  ZR_KEY_HOME,
  ZR_KEY_END,
  ZR_KEY_PAGE_UP,
  ZR_KEY_PAGE_DOWN,
  PAGE_SIZE,
} from './key-codes';

describe('calculateNextIndex', () => {
  const COUNT = 25;

  describe('arrow up', () => {
    it('should decrement by 1', () => {
      expect(calculateNextIndex(5, COUNT, ZR_KEY_UP)).toBe(4);
    });

    it('should not go below 0', () => {
      expect(calculateNextIndex(0, COUNT, ZR_KEY_UP)).toBe(0);
    });
  });

  describe('arrow down', () => {
    it('should increment by 1', () => {
      expect(calculateNextIndex(5, COUNT, ZR_KEY_DOWN)).toBe(6);
    });

    it('should not exceed last index', () => {
      expect(calculateNextIndex(24, COUNT, ZR_KEY_DOWN)).toBe(24);
    });
  });

  describe('home', () => {
    it('should jump to first index', () => {
      expect(calculateNextIndex(15, COUNT, ZR_KEY_HOME)).toBe(0);
    });
  });

  describe('end', () => {
    it('should jump to last index', () => {
      expect(calculateNextIndex(5, COUNT, ZR_KEY_END)).toBe(24);
    });
  });

  describe('page up', () => {
    it('should move up by PAGE_SIZE', () => {
      expect(calculateNextIndex(15, COUNT, ZR_KEY_PAGE_UP)).toBe(
        15 - PAGE_SIZE,
      );
    });

    it('should not go below 0', () => {
      expect(calculateNextIndex(3, COUNT, ZR_KEY_PAGE_UP)).toBe(0);
    });
  });

  describe('page down', () => {
    it('should move down by PAGE_SIZE', () => {
      expect(calculateNextIndex(5, COUNT, ZR_KEY_PAGE_DOWN)).toBe(
        5 + PAGE_SIZE,
      );
    });

    it('should not exceed last index', () => {
      expect(calculateNextIndex(20, COUNT, ZR_KEY_PAGE_DOWN)).toBe(24);
    });
  });

  describe('unrecognized key', () => {
    it('should return current index unchanged', () => {
      expect(calculateNextIndex(7, COUNT, 999)).toBe(7);
    });
  });
});
