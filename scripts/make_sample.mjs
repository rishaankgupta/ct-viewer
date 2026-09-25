// Build a small bundled sample for the viewer:
// decode the real AbdomenAtlas scan + selected masks, downsample, and
// re-encode as clean little-endian NIfTI-1 .nii.gz files.
import { gunzipSync, gzipSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const SRC = "/projects/sandbox/AbdomenAtlasDemo/BDMAP_00000006";
const OUT = "/projects/sandbox/ct-viewer/public/sample";
const F = 2; // downsample factor (x,y,z)

const MASKS = [
  "liver", "spleen", "stomach", "pancreas", "gall_bladder",
  "aorta", "kidney_left", "kidney_right", "liver_tumor",
  "femur_left", "femur_right",
];

function readNifti(path) {
  const buf = gunzipSync(readFileSync(path));
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const le = dv.getInt32(0, true) === 348;
  const i16 = (o) => dv.getInt16(o, le);
  const f32 = (o) => dv.getFloat32(o, le);
  const dims = [i16(42), i16(44), Math.max(1, i16(46))];
  const datatype = i16(70);
  const pixdim = [f32(80), f32(84), f32(88)].map((v) => (v === 0 ? 1 : Math.abs(v)));
  const voxOffset = Math.round(f32(108));
  let slope = f32(112); if (!slope) slope = 1;
  const inter = f32(116);
  const srow = [
    [f32(280), f32(284), f32(288), f32(292)],
    [f32(296), f32(300), f32(304), f32(308)],
    [f32(312), f32(316), f32(320), f32(324)],
  ];
  const n = dims[0] * dims[1] * dims[2];
  let data;
  if (datatype === 4) data = new Int16Array(buf.buffer, buf.byteOffset + voxOffset, n);
  else if (datatype === 256) data = new Int8Array(buf.buffer, buf.byteOffset + voxOffset, n);
  else if (datatype === 2) data = new Uint8Array(buf.buffer, buf.byteOffset + voxOffset, n);
  else if (datatype === 512) data = new Uint16Array(buf.buffer, buf.byteOffset + voxOffset, n);
  else if (datatype === 16) data = new Float32Array(buf.buffer, buf.byteOffset + voxOffset, n);
  else data = new Uint8Array(buf.buffer, buf.byteOffset + voxOffset, n);
  return { dims, datatype, pixdim, slope, inter, srow, data };
}

const idx = (x, y, z, d) => x + d[0] * (y + d[1] * z);

function downsampleCT(src) {
  const [nx, ny, nz] = src.dims;
  const mx = Math.floor(nx / F), my = Math.floor(ny / F), mz = Math.floor(nz / F);
  const out = new Int16Array(mx * my * mz);
  for (let z = 0; z < mz; z++)
    for (let y = 0; y < my; y++)
      for (let x = 0; x < mx; x++) {
        let sum = 0, c = 0;
        for (let dz = 0; dz < F; dz++)
          for (let dy = 0; dy < F; dy++)
            for (let dx = 0; dx < F; dx++) {
              const v = src.data[idx(x * F + dx, y * F + dy, z * F + dz, src.dims)];
              sum += v * src.slope + src.inter; c++;
            }
        out[idx(x, y, z, [mx, my, mz])] = Math.round(sum / c);
      }
  return { data: out, dims: [mx, my, mz] };
}

function downsampleMaskMax(src) {
  const [nx, ny, nz] = src.dims;
  const mx = Math.floor(nx / F), my = Math.floor(ny / F), mz = Math.floor(nz / F);
  const out = new Uint8Array(mx * my * mz);
  for (let z = 0; z < mz; z++)
    for (let y = 0; y < my; y++)
      for (let x = 0; x < mx; x++) {
        let fg = 0;
        for (let dz = 0; dz < F && !fg; dz++)
          for (let dy = 0; dy < F && !fg; dy++)
            for (let dx = 0; dx < F && !fg; dx++) {
              const lbl = Math.round(
                src.data[idx(x * F + dx, y * F + dy, z * F + dz, src.dims)] * src.slope + src.inter
              );
              if (lbl > 0) fg = 1;
            }
        out[idx(x, y, z, [mx, my, mz])] = fg;
      }
  return { data: out, dims: [mx, my, mz] };
}

function writeNifti(path, dims, datatype, typedData, pixdim, srow) {
  const bytesPer = datatype === 4 ? 2 : 1;
  const header = new ArrayBuffer(352);
  const dv = new DataView(header);
  dv.setInt32(0, 348, true);
  dv.setInt16(40, 3, true);
  dv.setInt16(42, dims[0], true);
  dv.setInt16(44, dims[1], true);
  dv.setInt16(46, dims[2], true);
  dv.setInt16(48, 1, true); dv.setInt16(50, 1, true);
  dv.setInt16(52, 1, true); dv.setInt16(54, 1, true);
  dv.setInt16(70, datatype, true);
  dv.setInt16(72, bytesPer * 8, true);
  dv.setFloat32(76, 1, true); // qfac
  dv.setFloat32(80, pixdim[0], true);
  dv.setFloat32(84, pixdim[1], true);
  dv.setFloat32(88, pixdim[2], true);
  dv.setFloat32(108, 352, true); // vox_offset
  dv.setFloat32(112, 1, true); // scl_slope
  dv.setFloat32(116, 0, true); // scl_inter
  dv.setInt16(252, 0, true); // qform_code
  dv.setInt16(254, 1, true); // sform_code = scanner
  for (let c = 0; c < 4; c++) {
    dv.setFloat32(280 + c * 4, srow[0][c], true);
    dv.setFloat32(296 + c * 4, srow[1][c], true);
    dv.setFloat32(312 + c * 4, srow[2][c], true);
  }
  // magic "n+1\0"
  dv.setUint8(344, 0x6e); dv.setUint8(345, 0x2b); dv.setUint8(346, 0x31); dv.setUint8(347, 0);

  const dataBytes = new Uint8Array(typedData.buffer, typedData.byteOffset, typedData.byteLength);
  const full = new Uint8Array(352 + dataBytes.length);
  full.set(new Uint8Array(header), 0);
  full.set(dataBytes, 352);
  writeFileSync(path, gzipSync(full, { level: 9 }));
  return full.length;
}

// Scale the affine linear part by F for the downsample; origin unchanged.
function scaleSrow(srow) {
  return srow.map((row) => [row[0] * F, row[1] * F, row[2] * F, row[3]]);
}

mkdirSync(OUT, { recursive: true });

console.log("Reading CT…");
const ct = readNifti(`${SRC}/ct.nii.gz`);
const ctDs = downsampleCT(ct);
const newPix = ct.pixdim.map((p) => p * F);
const newSrow = scaleSrow(ct.srow);
const ctRaw = writeNifti(`${OUT}/ct.nii.gz`, ctDs.dims, 4, ctDs.data, newPix, newSrow);
console.log(`  ct.nii.gz  dims=${ctDs.dims.join("x")} raw=${(ctRaw / 1e6).toFixed(1)}MB`);

const written = [];
for (const name of MASKS) {
  const p = `${SRC}/segmentations/${name}.nii.gz`;
  if (!existsSync(p)) { console.log(`  skip ${name} (missing)`); continue; }
  const src = readNifti(p);
  const ds = downsampleMaskMax(src);
  const fg = ds.data.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
  if (fg === 0) { console.log(`  skip ${name} (empty after downsample)`); continue; }
  writeNifti(`${OUT}/${name}.nii.gz`, ds.dims, 2, ds.data, newPix, newSrow);
  written.push(`${name}.nii.gz`);
  console.log(`  ${name}.nii.gz  fg voxels=${fg}`);
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify({ ct: "ct.nii.gz", masks: written }, null, 2));
console.log("Wrote manifest with", written.length, "masks →", OUT);
