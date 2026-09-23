/**
 * Colors for segmentation overlays.
 *
 * Named anatomical structures get sensible, memorable hues; anything else
 * (including numeric multi-label ids) falls back to a fixed, high-contrast
 * palette indexed deterministically so a structure keeps its color across
 * reloads.
 */

export type RGB = [number, number, number];

const NAMED: Record<string, RGB> = {
  liver: [193, 92, 66],
  spleen: [140, 60, 90],
  pancreas: [219, 168, 90],
  stomach: [120, 170, 110],
  gall_bladder: [90, 170, 120],
  aorta: [200, 55, 55],
  postcava: [70, 110, 200],
  inferior_vena_cava: [70, 110, 200],
  kidney_left: [95, 175, 205],
  kidney_right: [120, 195, 220],
  adrenal_gland_left: [200, 140, 210],
  adrenal_gland_right: [180, 120, 195],
  esophagus: [210, 175, 120],
  duodenum: [175, 150, 95],
  colon: [150, 130, 90],
  intestine: [160, 145, 100],
  bladder: [230, 205, 90],
  celiac_trunk: [225, 95, 120],
  hepatic_vessel: [120, 90, 190],
  lung_left: [90, 150, 190],
  lung_right: [110, 170, 205],
  femur_left: [210, 210, 200],
  femur_right: [225, 225, 215],
};

// Tumors / lesions read as warning reds so they stand out.
const TUMOR_RGB: RGB = [235, 70, 70];

const PALETTE: RGB[] = [
  [230, 75, 60],
  [60, 160, 230],
  [95, 200, 120],
  [235, 170, 60],
  [175, 110, 220],
  [70, 200, 200],
  [230, 120, 180],
  [150, 190, 70],
  [120, 130, 240],
  [235, 130, 70],
  [90, 210, 170],
  [210, 90, 140],
  [130, 200, 240],
  [200, 200, 90],
  [160, 120, 100],
  [110, 170, 130],
];

export function paletteColor(index: number): RGB {
  return PALETTE[index % PALETTE.length];
}

export function colorForStructure(nameOrId: string | number, fallbackIndex: number): RGB {
  if (typeof nameOrId === "number") return paletteColor(fallbackIndex);
  const key = nameOrId
    .toLowerCase()
    .replace(/\.nii(\.gz)?$/, "")
    .trim();
  if (NAMED[key]) return NAMED[key];
  if (key.includes("tumor") || key.includes("lesion") || key.includes("cyst")) return TUMOR_RGB;
  if (key.startsWith("vertebrae")) {
    // Spread vertebrae across the palette so adjacent levels differ.
    const n = parseInt(key.replace(/\D/g, ""), 10) || fallbackIndex;
    return paletteColor(n * 5 + 2);
  }
  return paletteColor(fallbackIndex);
}

export function prettyName(name: string): string {
  return name
    .replace(/\.nii(\.gz)?$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
