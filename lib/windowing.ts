/**
 * CT window/level (a.k.a. width/center) presets and a fast lookup table.
 *
 * A CT stores Hounsfield Units (HU). "Windowing" maps a HU interval
 * [center - width/2, center + width/2] onto the 0..255 grayscale so a given
 * tissue is visible. These presets are the standard radiology defaults.
 */

export interface WindowPreset {
  name: string;
  center: number; // level (HU)
  width: number; // window (HU)
}

export const WINDOW_PRESETS: WindowPreset[] = [
  { name: "Abdomen", center: 40, width: 400 },
  { name: "Soft tissue", center: 50, width: 350 },
  { name: "Bone", center: 400, width: 1800 },
  { name: "Lung", center: -600, width: 1500 },
  { name: "Brain", center: 40, width: 80 },
  { name: "Angio", center: 300, width: 600 },
];

/**
 * Build a grayscale lookup table covering [minHU, maxHU] so the per-pixel
 * inner loop is a single array index instead of a divide. Rebuilt only when
 * the window changes.
 */
export function buildWindowLUT(
  center: number,
  width: number,
  minHU: number,
  maxHU: number
): { lut: Uint8ClampedArray; minHU: number } {
  const lo = center - width / 2;
  const scale = 255 / Math.max(1, width);
  const size = Math.max(2, Math.round(maxHU - minHU) + 1);
  const lut = new Uint8ClampedArray(size);
  for (let i = 0; i < size; i++) {
    const hu = minHU + i;
    lut[i] = (hu - lo) * scale;
  }
  return { lut, minHU };
}
