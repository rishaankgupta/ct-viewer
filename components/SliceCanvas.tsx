"use client";

import { useEffect, useRef } from "react";
import type { NiftiVolume } from "@/lib/nifti";
import type { PlaneMapping } from "@/lib/geometry";
import type { RGB } from "@/lib/colors";

export interface Overlay {
  vol: NiftiVolume;
  /** colors[labelId] -> RGB (undefined = not shown) */
  colors: (RGB | undefined)[];
}

interface Props {
  ct: NiftiVolume;
  mapping: PlaneMapping;
  slice: number;
  lut: Uint8ClampedArray;
  lutMinHU: number;
  overlays: Overlay[];
  opacity: number;
  maxSize?: number;
  onWheelSlice?: (delta: number) => void;
}

function strides(dims: [number, number, number]): [number, number, number] {
  return [1, dims[0], dims[0] * dims[1]];
}

export default function SliceCanvas({
  ct,
  mapping,
  slice,
  lut,
  lutMinHU,
  overlays,
  opacity,
  maxSize = 340,
  onWheelSlice,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { hAxis, vAxis, sliceAxis, flipH, flipV, hPixels, vPixels } = mapping;
    canvas.width = hPixels;
    canvas.height = vPixels;

    const img = ctx.createImageData(hPixels, vPixels);
    const out = img.data;

    const ctStride = strides(ct.dims);
    const strideH = ctStride[hAxis];
    const strideV = ctStride[vAxis];
    const base = slice * ctStride[sliceAxis];

    const { data: ctData, sclSlope: cs, sclInter: ci } = ct;
    const lutMax = lut.length - 1;
    const op = opacity;
    const inv = 1 - op;

    // Precompute overlay stride sets (masks share the CT grid; guarded upstream)
    const ov = overlays.map((o) => ({
      data: o.vol.data,
      slope: o.vol.sclSlope,
      inter: o.vol.sclInter,
      colors: o.colors,
      base: slice * strides(o.vol.dims)[sliceAxis],
      sH: strides(o.vol.dims)[hAxis],
      sV: strides(o.vol.dims)[vAxis],
    }));

    let p = 0;
    for (let sv = 0; sv < vPixels; sv++) {
      const voxelV = flipV ? vPixels - 1 - sv : sv;
      const rowBase = base + voxelV * strideV;
      for (let sh = 0; sh < hPixels; sh++) {
        const voxelH = flipH ? hPixels - 1 - sh : sh;
        const idx = rowBase + voxelH * strideH;

        const hu = ctData[idx] * cs + ci;
        let li = Math.round(hu) - lutMinHU;
        if (li < 0) li = 0;
        else if (li > lutMax) li = lutMax;
        let r = lut[li];
        let g = r;
        let b = r;

        // overlays (topmost visible label wins)
        for (let k = 0; k < ov.length; k++) {
          const o = ov[k];
          const mIdx = o.base + voxelV * o.sV + voxelH * o.sH;
          const label = Math.round(o.data[mIdx] * o.slope + o.inter);
          if (label > 0) {
            const c = o.colors[label];
            if (c) {
              r = r * inv + c[0] * op;
              g = g * inv + c[1] * op;
              b = b * inv + c[2] * op;
            }
          }
        }

        out[p] = r;
        out[p + 1] = g;
        out[p + 2] = b;
        out[p + 3] = 255;
        p += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [ct, mapping, slice, lut, lutMinHU, overlays, opacity]);

  // Display size preserving physical aspect ratio.
  const aspect = mapping.physW / mapping.physH;
  let dispW = maxSize;
  let dispH = maxSize;
  if (aspect >= 1) dispH = Math.round(maxSize / aspect);
  else dispW = Math.round(maxSize * aspect);

  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">
        {mapping.name}
      </div>
      <div
        className="canvas-wrap relative rounded border border-edge"
        style={{ width: dispW, height: dispH }}
        onWheel={(e) => {
          if (!onWheelSlice) return;
          e.preventDefault();
          onWheelSlice(e.deltaY > 0 ? 1 : -1);
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ imageRendering: "auto" }}
        />
        <OrientationLabels m={mapping} />
      </div>
    </div>
  );
}

function OrientationLabels({ m }: { m: PlaneMapping }) {
  const base =
    "absolute text-[10px] font-semibold text-sky-300/80 select-none pointer-events-none";
  return (
    <>
      <span className={`${base} left-1 top-1/2 -translate-y-1/2`}>{m.left}</span>
      <span className={`${base} right-1 top-1/2 -translate-y-1/2`}>{m.right}</span>
      <span className={`${base} left-1/2 top-1 -translate-x-1/2`}>{m.top}</span>
      <span className={`${base} left-1/2 bottom-1 -translate-x-1/2`}>
        {m.bottom}
      </span>
    </>
  );
}
