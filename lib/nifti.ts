import pako from "pako";

/**
 * Minimal, dependency-light NIfTI-1 reader.
 *
 * Supports the single-file ".nii" / gzipped ".nii.gz" layout produced by the
 * BodyMaps / AbdomenAtlas pipeline (and most medical tools). Handles
 * endianness, the common scalar datatypes, scl_slope/scl_inter rescaling and
 * the sform affine.
 *
 * Verified against real AbdomenAtlas scans:
 *   ct.nii.gz            -> int16, HU, slope 1 / inter 0
 *   combined_labels.nii.gz -> int8, integer labels 0..N (slope 1)
 *   liver.nii.gz         -> int8 with slope ~1/255, inter ~128/255 (binary 0/1)
 */

export type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;

export interface NiftiVolume {
  dims: [number, number, number];
  /** voxel spacing in mm (sx, sy, sz) */
  pixdim: [number, number, number];
  datatypeCode: number;
  datatypeName: string;
  sclSlope: number;
  sclInter: number;
  /** 4x4 voxel->world (RAS+) affine */
  affine: number[][];
  data: TypedArray;
  /** scaled intensity range (data * slope + inter) */
  min: number;
  max: number;
}

const DTYPE_NAMES: Record<number, string> = {
  2: "uint8",
  4: "int16",
  8: "int32",
  16: "float32",
  64: "float64",
  256: "int8",
  512: "uint16",
  768: "uint32",
};

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export function parseNifti(input: ArrayBuffer): NiftiVolume {
  let bytes = new Uint8Array(input);
  if (isGzip(bytes)) {
    bytes = pako.ungzip(bytes);
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Endianness: sizeof_hdr must equal 348.
  let little = true;
  if (dv.getInt32(0, true) !== 348) {
    little = false;
    if (dv.getInt32(0, false) !== 348) {
      throw new Error("Not a NIfTI-1 file (bad sizeof_hdr).");
    }
  }

  const i16 = (o: number) => dv.getInt16(o, little);
  const f32 = (o: number) => dv.getFloat32(o, little);

  const dim0 = i16(40);
  const nx = i16(42);
  const ny = i16(44);
  const nz = Math.max(1, i16(46));
  if (dim0 < 3) {
    // still allow, treat missing dims as 1
  }

  const datatypeCode = i16(70);
  const pixdim: [number, number, number] = [f32(80), f32(84), f32(88)].map((v) =>
    v === 0 ? 1 : Math.abs(v)
  ) as [number, number, number];

  const voxOffset = Math.round(f32(108));
  let sclSlope = f32(112);
  const sclInter = f32(116);
  if (!sclSlope || Number.isNaN(sclSlope)) sclSlope = 1;

  // sform affine (voxel -> world). Falls back to a diagonal from pixdim.
  const sformCode = i16(254);
  let affine: number[][];
  if (sformCode > 0) {
    affine = [
      [f32(280), f32(284), f32(288), f32(292)],
      [f32(296), f32(300), f32(304), f32(308)],
      [f32(312), f32(316), f32(320), f32(324)],
      [0, 0, 0, 1],
    ];
  } else {
    affine = [
      [pixdim[0], 0, 0, 0],
      [0, pixdim[1], 0, 0],
      [0, 0, pixdim[2], 0],
      [0, 0, 0, 1],
    ];
  }

  const nvox = nx * ny * nz;

  // Copy the data region into its own buffer so typed-array alignment is safe.
  const bytesPer = bytesPerVoxel(datatypeCode);
  const dataSlice = bytes.slice(voxOffset, voxOffset + nvox * bytesPer);
  const data = makeTypedArray(datatypeCode, dataSlice.buffer, nvox);

  const { min, max } = scaledRange(data, sclSlope, sclInter);

  return {
    dims: [nx, ny, nz],
    pixdim,
    datatypeCode,
    datatypeName: DTYPE_NAMES[datatypeCode] ?? `code_${datatypeCode}`,
    sclSlope,
    sclInter,
    affine,
    data,
    min,
    max,
  };
}

function bytesPerVoxel(code: number): number {
  switch (code) {
    case 2:
    case 256:
      return 1;
    case 4:
    case 512:
      return 2;
    case 8:
    case 16:
    case 768:
      return 4;
    case 64:
      return 8;
    default:
      return 1;
  }
}

function makeTypedArray(code: number, buffer: ArrayBuffer, n: number): TypedArray {
  switch (code) {
    case 2:
      return new Uint8Array(buffer, 0, n);
    case 4:
      return new Int16Array(buffer, 0, n);
    case 8:
      return new Int32Array(buffer, 0, n);
    case 16:
      return new Float32Array(buffer, 0, n);
    case 64:
      return new Float64Array(buffer, 0, n);
    case 256:
      return new Int8Array(buffer, 0, n);
    case 512:
      return new Uint16Array(buffer, 0, n);
    case 768:
      return new Uint32Array(buffer, 0, n);
    default:
      return new Uint8Array(buffer, 0, n);
  }
}

/** Sampled scaled min/max — fast enough for full-resolution CT volumes. */
function scaledRange(data: TypedArray, slope: number, inter: number) {
  let min = Infinity;
  let max = -Infinity;
  const step = data.length > 4_000_000 ? 37 : 1;
  for (let i = 0; i < data.length; i += step) {
    const v = data[i] * slope + inter;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }
  return { min, max };
}

/**
 * Distinct integer label ids present in a mask volume, using the verified
 * rule  label = round(raw * slope + inter). Works for both binary structure
 * masks (0/1) and multi-label files (combined_labels: 0..N).
 */
export function labelSet(vol: NiftiVolume, cap = 512): number[] {
  const set = new Set<number>();
  const { data, sclSlope, sclInter } = vol;
  for (let i = 0; i < data.length; i++) {
    const label = Math.round(data[i] * sclSlope + sclInter);
    if (label > 0) {
      set.add(label);
      if (set.size >= cap) break;
    }
  }
  return [...set].sort((a, b) => a - b);
}

/** Anatomical letters for +/- of each display axis, derived from the affine. */
export function orientationLetters(affine: number[][]) {
  // NIfTI world space is RAS+: +x -> Right, +y -> Anterior, +z -> Superior.
  const pos = ["R", "A", "S"];
  const neg = ["L", "P", "I"];
  // For voxel axis j, world direction is column j of the 3x3 linear part.
  const forAxis = (j: number) => {
    const col = [affine[0][j], affine[1][j], affine[2][j]];
    let k = 0;
    for (let r = 1; r < 3; r++) if (Math.abs(col[r]) > Math.abs(col[k])) k = r;
    const positive = col[k] >= 0;
    return { plus: positive ? pos[k] : neg[k], minus: positive ? neg[k] : pos[k] };
  };
  return { x: forAxis(0), y: forAxis(1), z: forAxis(2) };
}
