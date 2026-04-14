import { rgb } from '@rezi-ui/core';

export const NEON = rgb(57, 255, 20);
export const DIM = rgb(100, 100, 100);
export const ERROR_COLOR = rgb(255, 80, 80);

export const BOX_DEFAULTS = {
  border: 'single' as const,
  borderStyle: { fg: NEON },
  width: 'full' as const,
  p: 1,
};
