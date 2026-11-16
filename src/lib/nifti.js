// NIfTI helpers: read a .nii/.nii.gz ArrayBuffer, and write a volume back to .nii
import * as nifti from 'nifti-reader-js'

function asTypedArray (header, buffer) {
  switch (header.datatypeCode) {
    case nifti.NIFTI1.TYPE_INT8: return new Int8Array(buffer)
    case nifti.NIFTI1.TYPE_UINT8: return new Uint8Array(buffer)
    case nifti.NIFTI1.TYPE_INT16: return new Int16Array(buffer)
    case nifti.NIFTI1.TYPE_UINT16: return new Uint16Array(buffer)
    case nifti.NIFTI1.TYPE_INT32: return new Int32Array(buffer)
    case nifti.NIFTI1.TYPE_UINT32: return new Uint32Array(buffer)
    case nifti.NIFTI1.TYPE_FLOAT64: return new Float64Array(buffer)
    default: return new Float32Array(buffer)
  }
}

export function minmax (arr) {
  let mn = Infinity; let mx = -Infinity
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v < mn) mn = v; if (v > mx) mx = v }
  return [mn, mx]
}

/** Volume shape used everywhere: { data: Float32Array, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min, max } */
export function parseNifti (ab) {
  if (nifti.isCompressed(ab)) ab = nifti.decompress(ab)
  if (!nifti.isNIFTI(ab)) throw new Error('the server did not return a NIfTI file')
  const header = nifti.readHeader(ab)
  const ta = asTypedArray(header, nifti.readImage(header, ab))
  let f32
  if (ta instanceof Float32Array) f32 = ta
  else if (ta instanceof Float64Array) f32 = Float32Array.from(ta)
  else {
    const [mn, mx] = minmax(ta); const range = (mx - mn) || 1
    f32 = new Float32Array(ta.length)
    for (let i = 0; i < ta.length; i++) f32[i] = (ta[i] - mn) / range
  }
  const dims = [header.dims[1] | 0, header.dims[2] | 0, header.dims[3] | 0]
  if (!dims[0] || !dims[1] || !dims[2]) throw new Error('invalid dims')
  const [mn, mx] = minmax(f32)
  const voxelMM = [1, 2, 3].map(i => Math.abs(header.pixDims?.[i] ?? 1))
  return { data: f32, dims, voxelMM, min: mn, max: mx }
}

export async function loadNiftiUrl (url, signal) {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`${res.status} ${t.slice(0, 200)}`)
  }
  return parseNifti(await res.arrayBuffer())
}

// Standard MNI152 2 mm grid
export const MNI_AFFINE = [[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72]]

/** Float32 volume on the MNI152 2 mm grid → single-file NIfTI-1 (.nii) Blob */
export function writeNifti (vol) {
  const [nx, ny, nz] = vol.dims
  const buf = new ArrayBuffer(352 + vol.data.length * 4)
  const dv = new DataView(buf)
  dv.setInt32(0, 348, true) // sizeof_hdr
  ;[3, nx, ny, nz, 1, 1, 1, 1].forEach((v, i) => dv.setInt16(40 + i * 2, v, true)) // dim
  dv.setInt16(70, 16, true) // datatype: float32
  dv.setInt16(72, 32, true) // bitpix
  ;[1, 2, 2, 2, 1, 1, 1, 1].forEach((v, i) => dv.setFloat32(76 + i * 4, v, true)) // pixdim
  dv.setFloat32(108, 352, true) // vox_offset
  dv.setFloat32(112, 1, true) // scl_slope
  dv.setUint8(123, 2 | 8) // xyzt_units: mm, sec
  dv.setInt16(252, 0, true) // qform_code
  dv.setInt16(254, 4, true) // sform_code: MNI
  MNI_AFFINE.forEach((row, r) => row.forEach((v, c) => dv.setFloat32(280 + r * 16 + c * 4, v, true)))
  ;[0x6e, 0x2b, 0x31, 0].forEach((b, i) => dv.setUint8(344 + i, b)) // magic "n+1\0"
  new Float32Array(buf, 352).set(vol.data)
  return new Blob([buf], { type: 'application/octet-stream' })
}
