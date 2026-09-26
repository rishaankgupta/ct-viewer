"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { parseNifti, labelSet, type NiftiVolume } from "@/lib/nifti";
import { buildPlaneMappings, type PlaneMapping } from "@/lib/geometry";
import { buildWindowLUT, WINDOW_PRESETS } from "@/lib/windowing";
import { colorForStructure, paletteColor, prettyName, type RGB } from "@/lib/colors";
import SliceCanvas, { type Overlay } from "./SliceCanvas";

interface LoadedMask {
  key: string;
  fileName: string;
  vol: NiftiVolume;
}

interface StructureEntry {
  key: string;
  maskKey: string;
  labelId: number;
  name: string;
  color: RGB;
  visible: boolean;
}

const rgbCss = (c: RGB) => `rgb(${c[0]},${c[1]},${c[2]})`;

let uid = 0;
const nextId = () => `${Date.now()}_${uid++}`;

export default function Viewer() {
  const [ct, setCt] = useState<NiftiVolume | null>(null);
  const [ctName, setCtName] = useState<string>("");
  const [masks, setMasks] = useState<LoadedMask[]>([]);
  const [structures, setStructures] = useState<StructureEntry[]>([]);
  const [center, setCenter] = useState(40);
  const [width, setWidth] = useState(400);
  const [opacity, setOpacity] = useState(0.45);
  const [focus, setFocus] = useState<[number, number, number]>([0, 0, 0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ctInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);

  const mappings = useMemo(
    () => (ct ? buildPlaneMappings(ct.affine, ct.dims, ct.pixdim) : null),
    [ct]
  );

  const lutInfo = useMemo(() => {
    if (!ct) return null;
    const minHU = Math.floor(ct.min);
    const maxHU = Math.ceil(ct.max);
    return buildWindowLUT(center, width, minHU, maxHU);
  }, [ct, center, width]);

  // Group visible structures by their source mask volume -> one Overlay each.
  const overlays: Overlay[] = useMemo(() => {
    if (!ct) return [];
    const byMask = new Map<string, Overlay>();
    for (const s of structures) {
      if (!s.visible) continue;
      const mask = masks.find((m) => m.key === s.maskKey);
      if (!mask) continue;
      if (mask.vol.dims[0] !== ct.dims[0] || mask.vol.dims[1] !== ct.dims[1] || mask.vol.dims[2] !== ct.dims[2])
        continue;
      let ov = byMask.get(s.maskKey);
      if (!ov) {
        ov = { vol: mask.vol, colors: [] };
        byMask.set(s.maskKey, ov);
      }
      ov.colors[s.labelId] = s.color;
    }
    return [...byMask.values()];
  }, [structures, masks, ct]);

  const resetFocus = (vol: NiftiVolume) => {
    setFocus([
      Math.floor(vol.dims[0] / 2),
      Math.floor(vol.dims[1] / 2),
      Math.floor(vol.dims[2] / 2),
    ]);
  };

  // Hounsfield value under the crosshair (nice readout + proves indexing).
  const focusHU = useMemo(() => {
    if (!ct) return null;
    const [x, y, z] = focus;
    const i = x + ct.dims[0] * (y + ct.dims[1] * z);
    if (i < 0 || i >= ct.data.length) return null;
    return Math.round(ct.data[i] * ct.sclSlope + ct.sclInter);
  }, [ct, focus]);

  const loadCtBuffer = useCallback((buf: ArrayBuffer, name: string) => {
    const vol = parseNifti(buf);
    setCt(vol);
    setCtName(name);
    resetFocus(vol);
    // choose a sensible default window from datatype
    if (vol.max <= 2) {
      setCenter(0.5);
      setWidth(1);
    }
  }, []);

  const addMaskBuffer = useCallback(
    (buf: ArrayBuffer, name: string) => {
      const vol = parseNifti(buf);
      const key = nextId();
      const labels = labelSet(vol);
      setMasks((prev) => [...prev, { key, fileName: name, vol }]);
      setStructures((prev) => {
        const additions: StructureEntry[] =
          labels.length <= 1
            ? [
                {
                  key: `${key}:1`,
                  maskKey: key,
                  labelId: labels[0] ?? 1,
                  name: prettyName(name),
                  color: colorForStructure(name, prev.length),
                  visible: true,
                },
              ]
            : labels.map((id, i) => ({
                key: `${key}:${id}`,
                maskKey: key,
                labelId: id,
                name: `${prettyName(name)} · ${id}`,
                color: paletteColor(id),
                visible: true,
              }));
        return [...prev, ...additions];
      });
    },
    []
  );

  const readFile = (f: File) =>
    new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(f);
    });

  const onCtFile = async (files: FileList | null) => {
    if (!files || !files[0]) return;
    setError(null);
    setBusy("Loading CT…");
    try {
      const buf = await readFile(files[0]);
      loadCtBuffer(buf, files[0].name);
    } catch (e) {
      setError(`Failed to load CT: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onMaskFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy("Loading masks…");
    try {
      for (const f of Array.from(files)) {
        const buf = await readFile(f);
        addMaskBuffer(buf, f.name);
      }
    } catch (e) {
      setError(`Failed to load mask: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const loadSample = async () => {
    setError(null);
    setBusy("Loading sample scan…");
    try {
      const manifest = await fetch("/sample/manifest.json").then((r) => {
        if (!r.ok) throw new Error("sample manifest not found");
        return r.json();
      });
      const ctBuf = await fetch(`/sample/${manifest.ct}`).then((r) => r.arrayBuffer());
      // reset previous state
      setMasks([]);
      setStructures([]);
      loadCtBuffer(ctBuf, manifest.ct);
      for (const mName of manifest.masks as string[]) {
        const mBuf = await fetch(`/sample/${mName}`).then((r) => r.arrayBuffer());
        addMaskBuffer(mBuf, mName);
      }
    } catch (e) {
      setError(`Could not load sample: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const toggleStructure = (key: string) =>
    setStructures((prev) =>
      prev.map((s) => (s.key === key ? { ...s, visible: !s.visible } : s))
    );

  const setAllVisible = (v: boolean) =>
    setStructures((prev) => prev.map((s) => ({ ...s, visible: v })));

  const clearAll = () => {
    setCt(null);
    setCtName("");
    setMasks([]);
    setStructures([]);
  };

  const bumpSlice = (axis: number, delta: number, max: number) =>
    setFocus((prev) => {
      const f = [...prev] as [number, number, number];
      f[axis] = Math.max(0, Math.min(max - 1, f[axis] + delta));
      return f;
    });

  const setSliceAxis = (axis: number, val: number) =>
    setFocus((prev) => {
      const f = [...prev] as [number, number, number];
      f[axis] = val;
      return f;
    });

  // Click on any plane -> move the shared focus in that plane's two axes.
  const pick = (m: PlaneMapping, vh: number, vv: number) =>
    setFocus((prev) => {
      const f = [...prev] as [number, number, number];
      f[m.hAxis] = vh;
      f[m.vAxis] = vv;
      return f;
    });

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-edge bg-panel p-4">
        <div>
          <h1 className="text-base font-semibold text-slate-100">BodyMaps CT Viewer</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
            Browser-based viewer for CT scans and per-voxel annotated structures
            (NIfTI). Runs fully client-side — no upload, no server.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={loadSample}
            className="rounded bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500"
          >
            ▶ Load sample scan
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => ctInputRef.current?.click()}
              className="rounded border border-edge bg-panelalt px-2 py-2 text-xs hover:border-sky-500"
            >
              Load CT…
            </button>
            <button
              onClick={() => maskInputRef.current?.click()}
              className="rounded border border-edge bg-panelalt px-2 py-2 text-xs hover:border-sky-500"
            >
              Add masks…
            </button>
          </div>
          <input
            ref={ctInputRef}
            type="file"
            accept=".nii,.gz"
            className="hidden"
            onChange={(e) => onCtFile(e.target.files)}
          />
          <input
            ref={maskInputRef}
            type="file"
            accept=".nii,.gz"
            multiple
            className="hidden"
            onChange={(e) => onMaskFiles(e.target.files)}
          />
          {ct && (
            <button
              onClick={clearAll}
              className="rounded border border-edge px-2 py-1 text-[11px] text-slate-400 hover:border-red-500 hover:text-red-300"
            >
              Clear
            </button>
          )}
        </div>

        {busy && <div className="text-xs text-sky-300">{busy}</div>}
        {error && (
          <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {ct && (
          <div className="rounded border border-edge bg-panelalt p-3 text-[11px] text-slate-300">
            <div className="mb-1 font-semibold text-slate-200">{ctName}</div>
            <div>dims: {ct.dims.join(" × ")}</div>
            <div>
              spacing: {ct.pixdim.map((p) => p.toFixed(2)).join(" × ")} mm
            </div>
            <div>
              dtype: {ct.datatypeName} · HU {Math.floor(ct.min)}…{Math.ceil(ct.max)}
            </div>
            {focusHU !== null && (
              <div className="mt-1 text-cyan-300">
                crosshair: [{focus.join(", ")}] · {focusHU} HU
              </div>
            )}
          </div>
        )}

        {/* Windowing */}
        {ct && (
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Window / Level
            </div>
            <div className="flex flex-wrap gap-1">
              {WINDOW_PRESETS.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setCenter(p.center);
                    setWidth(p.width);
                  }}
                  className={`rounded px-2 py-1 text-[10px] ${
                    center === p.center && width === p.width
                      ? "bg-sky-600 text-white"
                      : "border border-edge bg-panelalt text-slate-300 hover:border-sky-500"
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
            <label className="text-[11px] text-slate-400">
              Level {center} HU
              <input
                type="range"
                min={-1000}
                max={1500}
                value={center}
                onChange={(e) => setCenter(Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>
            <label className="text-[11px] text-slate-400">
              Width {width} HU
              <input
                type="range"
                min={1}
                max={3000}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="mt-1 w-full"
              />
            </label>
          </div>
        )}

        {/* Overlay opacity + structures */}
        {ct && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Structures ({structures.filter((s) => s.visible).length}/{structures.length})
              </span>
              {structures.length > 0 && (
                <span className="flex gap-2 text-[10px]">
                  <button className="text-sky-400 hover:underline" onClick={() => setAllVisible(true)}>
                    all
                  </button>
                  <button className="text-slate-500 hover:underline" onClick={() => setAllVisible(false)}>
                    none
                  </button>
                </span>
              )}
            </div>
            <label className="text-[11px] text-slate-400">
              Overlay opacity {Math.round(opacity * 100)}%
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                className="mt-1 w-full"
              />
            </label>
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
              {structures.length === 0 && (
                <div className="text-[11px] text-slate-500">
                  No masks loaded. Use “Add masks…” or load the sample.
                </div>
              )}
              {structures.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggleStructure(s.key)}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-left text-[11px] ${
                    s.visible ? "bg-panelalt" : "opacity-40 hover:opacity-70"
                  }`}
                >
                  <span
                    className="inline-block h-3 w-3 shrink-0 rounded-sm border border-black/40"
                    style={{ background: rgbCss(s.color) }}
                  />
                  <span className="truncate text-slate-200">{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-auto text-[10px] leading-relaxed text-slate-500">
          Demo for the BodyMaps developer program (Project 1 · CT viewer).
          NIfTI parsing, HU windowing, RAS+ orientation and MPR rendering
          implemented from scratch (no medical-imaging library).
        </div>
      </aside>

      {/* Main viewport */}
      <main className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto bg-[#0a0e17] p-4">
        {!ct || !mappings || !lutInfo ? (
          <div className="max-w-md text-center text-sm text-slate-400">
            <div className="mb-3 text-5xl">🩻</div>
            <p className="mb-2 text-slate-200">Load a CT scan to begin.</p>
            <p className="text-[12px] leading-relaxed">
              Click <span className="text-sky-300">Load sample scan</span> for a
              bundled abdominal CT with segmentations, or load your own{" "}
              <code className="text-slate-300">ct.nii.gz</code> and mask files.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              {(["Axial", "Coronal", "Sagittal"] as const).map((plane) => {
                const m = mappings[plane];
                return (
                  <div key={plane} className="flex flex-col items-center gap-2">
                    <SliceCanvas
                      ct={ct}
                      mapping={m}
                      focus={focus}
                      lut={lutInfo.lut}
                      lutMinHU={lutInfo.minHU}
                      overlays={overlays}
                      opacity={opacity}
                      onPick={(vh, vv) => pick(m, vh, vv)}
                      onWheelSlice={(d) => bumpSlice(m.sliceAxis, d, m.nSlices)}
                    />
                    <input
                      type="range"
                      min={0}
                      max={m.nSlices - 1}
                      value={focus[m.sliceAxis]}
                      onChange={(e) => setSliceAxis(m.sliceAxis, Number(e.target.value))}
                      className="w-full max-w-[340px]"
                    />
                    <div className="text-[10px] text-slate-500">
                      slice {focus[m.sliceAxis] + 1} / {m.nSlices}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
