/**
 * Maps the three voxel axes onto the three orthogonal display planes
 * (axial / coronal / sagittal) using the NIfTI RAS+ affine, so slices come
 * out in radiological convention with correct anatomical orientation and
 * physical aspect ratio — regardless of how the volume was stored.
 */

const POS = ["R", "A", "S"] as const;
const NEG = ["L", "P", "I"] as const;

interface AxisInfo {
  dom: 0 | 1 | 2; // dominant world axis: 0=L/R, 1=A/P, 2=S/I
  dirPlus: string; // anatomical direction that INCREASING this voxel axis points to
}

function argmaxAbs(v: number[]): 0 | 1 | 2 {
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[k])) k = i;
  return k as 0 | 1 | 2;
}

function axisInfo(affine: number[][], a: number): AxisInfo {
  const col = [affine[0][a], affine[1][a], affine[2][a]];
  const dom = argmaxAbs(col);
  const sgn = col[dom] >= 0 ? 1 : -1;
  const dirPlus = sgn > 0 ? POS[dom] : NEG[dom];
  return { dom, dirPlus };
}

const opposite: Record<string, string> = {
  R: "L", L: "R", A: "P", P: "A", S: "I", I: "S",
};

export interface PlaneMapping {
  name: "Axial" | "Coronal" | "Sagittal";
  hAxis: number;
  vAxis: number;
  sliceAxis: number;
  flipH: boolean;
  flipV: boolean;
  nSlices: number;
  hPixels: number;
  vPixels: number;
  physW: number; // physical width (mm)
  physH: number; // physical height (mm)
  left: string;
  right: string;
  top: string;
  bottom: string;
}

export interface PlaneMappings {
  Axial: PlaneMapping;
  Coronal: PlaneMapping;
  Sagittal: PlaneMapping;
}

export function buildPlaneMappings(
  affine: number[][],
  dims: [number, number, number],
  pixdim: [number, number, number]
): PlaneMappings {
  const infos = [axisInfo(affine, 0), axisInfo(affine, 1), axisInfo(affine, 2)];
  const axisForDom = (d: 0 | 1 | 2) => infos.findIndex((i) => i.dom === d);

  const make = (
    name: PlaneMapping["name"],
    hDom: 0 | 1 | 2,
    vDom: 0 | 1 | 2,
    sliceDom: 0 | 1 | 2,
    targetLeft: string,
    targetTop: string
  ): PlaneMapping => {
    const hAxis = axisForDom(hDom);
    const vAxis = axisForDom(vDom);
    const sliceAxis = axisForDom(sliceDom);
    // Put targetLeft/targetTop at screen-min. screen-min = voxel 0 shows
    // dirMinus; flip when the increasing direction already equals the target.
    const flipH = infos[hAxis].dirPlus === targetLeft;
    const flipV = infos[vAxis].dirPlus === targetTop;
    return {
      name,
      hAxis,
      vAxis,
      sliceAxis,
      flipH,
      flipV,
      nSlices: dims[sliceAxis],
      hPixels: dims[hAxis],
      vPixels: dims[vAxis],
      physW: dims[hAxis] * pixdim[hAxis],
      physH: dims[vAxis] * pixdim[vAxis],
      left: targetLeft,
      right: opposite[targetLeft],
      top: targetTop,
      bottom: opposite[targetTop],
    };
  };

  return {
    // Axial: look down S/I; patient Right on image-left, Anterior at top.
    Axial: make("Axial", 0, 1, 2, "R", "A"),
    // Coronal: look along A/P; patient Right on image-left, Superior at top.
    Coronal: make("Coronal", 0, 2, 1, "R", "S"),
    // Sagittal: look along L/R; Anterior on image-left, Superior at top.
    Sagittal: make("Sagittal", 1, 2, 0, "A", "S"),
  };
}
