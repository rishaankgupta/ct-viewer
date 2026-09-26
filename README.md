# BodyMaps CT Viewer

A browser-based viewer for **CT scans and per-voxel annotated structures** (NIfTI),
built for the BodyMaps developer program — **Project 1 (web CT viewer, a 3D-Slicer-style
tool in the browser)**. It loads `.nii` / `.nii.gz` volumes and renders synchronized
**axial / coronal / sagittal** planes with segmentation overlays, entirely client-side
(no upload, no server, no PHI leaves the browser).

> Built with Next.js + TypeScript + Tailwind. NIfTI parsing, HU windowing, RAS+
> orientation handling, and multi-planar rendering are implemented **from scratch** —
> no medical-imaging library — to demonstrate the underlying engineering.

## Features

- **Load** `ct.nii.gz` plus any number of mask files (single-structure or multi-label).
- **Multi-planar reconstruction (MPR):** axial, coronal, sagittal, each with its own
  slice slider + mouse-wheel scrolling.
- **Correct radiology conventions:** anatomical orientation labels (R/L/A/P/S/I) derived
  from the NIfTI **RAS+** affine, and physical **aspect ratio** from voxel spacing
  (so anisotropic scans aren't squished).
- **HU windowing:** standard presets (Abdomen, Soft tissue, Bone, Lung, Brain, Angio)
  plus manual level/width sliders, implemented with a fast lookup table.
- **Segmentation overlays:** per-structure color + visibility toggle, global opacity,
  named structures colored sensibly (liver, aorta, kidneys, tumors, …).
- **Bundled sample** abdominal CT with 11 organ/lesion masks for an instant demo.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
# or a production build:
npm run build && npm run start
```

Click **“Load sample scan”**, or **“Load CT…”** + **“Add masks…”** to view your own
NIfTI files. Files are read locally via the File API — nothing is uploaded.

## Deploy (Vercel)

```bash
npm i -g vercel   # if needed
vercel            # follow prompts; framework auto-detected as Next.js
```

Any static/Node host that supports Next.js works. The app is fully static except for
serving the bundled sample under `public/sample/`.

## Architecture

```
app/
  layout.tsx          root layout + metadata
  page.tsx            renders the Viewer
components/
  Viewer.tsx          state, file loading, sidebar controls, layout
  SliceCanvas.tsx     renders ONE plane to a <canvas> (CT + overlays)
lib/
  nifti.ts            NIfTI-1 parser: gunzip (pako) + header/data + affine + label set
  geometry.ts         voxel-axis -> screen-plane mapping (RAS+), flips, aspect, labels
  windowing.ts        HU window presets + grayscale lookup table
  colors.ts           anatomical color map + fallback palette
public/sample/        bundled downsampled CT + masks + manifest.json
scripts/
  make_sample.mjs     regenerates the sample from a full-res AbdomenAtlas case
```

### How the imaging pieces work (design notes)

- **NIfTI parsing** (`lib/nifti.ts`). Detects gzip (`0x1f 0x8b`) and inflates with `pako`,
  checks endianness via `sizeof_hdr == 348`, reads `dim`, `datatype`, `pixdim`,
  `vox_offset`, `scl_slope`/`scl_inter`, and the `sform` affine. Data is copied into an
  aligned buffer and exposed as the correct typed array. Supported datatypes include
  int8/uint8/int16/uint16/int32/float32/float64.
- **Label decoding.** Real AbdomenAtlas masks store labels as `int8` — `combined_labels`
  uses slope 1 (integers `0..N`), while individual structures use `scl_slope ≈ 1/255`,
  `scl_inter ≈ 128/255`. Both are handled uniformly with `label = round(raw*slope+inter)`.
- **Orientation** (`lib/geometry.ts`). NIfTI world space is **RAS+** (+x→Right, +y→Anterior,
  +z→Superior). For each display plane we pick the voxel axis whose affine column is
  dominant along the needed world axis, and flip it so the view matches radiological
  convention (patient-right on image-left, anterior up on axial, superior up on
  coronal/sagittal). Orientation letters are drawn from the same computation.
- **Windowing** (`lib/windowing.ts`). A CT stores Hounsfield Units; a window maps
  `[center-width/2, center+width/2]` to `0..255`. A per-window LUT keeps the per-pixel
  loop to a single array lookup.
- **Rendering** (`components/SliceCanvas.tsx`). Extracts a 2-D slice by computing voxel
  strides once, writes grayscale into an `ImageData`, then alpha-blends each visible
  structure's color. The canvas is drawn at native voxel resolution and CSS-scaled to the
  correct physical aspect ratio.

## Regenerating the sample

The bundled sample is a 2× downsampled copy of one AbdomenAtlas demo case. With a
full-resolution case available locally:

```bash
node scripts/make_sample.mjs   # edit SRC path inside the script
```

## Possible extensions

- Linked crosshair across the three planes; click-to-navigate.
- 3-D volume/mesh rendering (WebGL) of selected structures.
- Distance / HU probe and ROI statistics.
- Drag-to-window (level/width via mouse), like clinical viewers.
- Streaming/lazy decode for very large volumes.

## License / data

Sample imagery is derived from the AbdomenAtlas demo distributed by the BodyMaps /
SuPreM project for this application exercise.
