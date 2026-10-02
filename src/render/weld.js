// src/render/weld.js: indexed geometry for the faceted props and figures.
//
// The figures, guns, horses and fences are built from boxes and cylinders split into separate triangles,
// so every triangle carried its own three vertices and the GPU shaded each box corner up to six times.
// On the UHD 617 the frame was bound by that vertex work, not by pixels (DECISIONS 0012). weldFlat()
// drops the per-face normals and merges identical vertices, so a box is 8 shaded vertices instead of 36;
// the materials then draw with flatShading (face normals from screen-space derivatives), which looks the same.

import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** Indexed copy of `geo` without normals (draw it with a flatShading material). Keeps userData. */
export function weldFlat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('normal');
  if (g.attributes.uv) g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-4);
  w.userData = { ...geo.userData };
  w.computeBoundingSphere();
  return w;
}

/** Indexed copy with smooth normals (seams welded first), for rounded shapes such as tree crowns. */
export function weldSmooth(geo) {
  const g = geo.clone();
  g.deleteAttribute('normal');
  if (g.attributes.uv) g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-4);
  w.computeVertexNormals();
  return w;
}
