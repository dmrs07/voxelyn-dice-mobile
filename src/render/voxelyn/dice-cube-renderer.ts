import {
  clearSurface,
  createSurface2D,
  fillRect,
  packRGBA,
  presentToCanvas,
  setPixel,
} from '@voxelyn/core';
import type { DiceFaceDef } from '../../domain/shared/types';

export interface QuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface DiceCubeRenderFrame {
  face: DiceFaceDef;
  rotation: QuaternionLike;
  shadowAlpha?: number;
  mode: 'physics_voxel' | 'frames_voxel';
}

type Vec2 = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };

const surfaceCache = new WeakMap<HTMLCanvasElement, ReturnType<typeof createSurface2D>>();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clamp255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const kindRgb = (kind: DiceFaceDef['kind']): { r: number; g: number; b: number } => {
  if (kind === 'empty') return { r: 128, g: 128, b: 134 };
  if (kind === 'attack') return { r: 198, g: 74, b: 58 };
  if (kind === 'block') return { r: 62, g: 116, b: 184 };
  if (kind === 'heal') return { r: 64, g: 154, b: 88 };
  if (kind === 'mark') return { r: 173, g: 129, b: 52 };
  if (kind === 'cleanse') return { r: 70, g: 162, b: 140 };
  if (kind === 'swap') return { r: 86, g: 124, b: 188 };
  if (kind === 'stun') return { r: 132, g: 95, b: 178 };
  if (kind === 'focus') return { r: 186, g: 150, b: 64 };
  if (kind === 'special') return { r: 201, g: 119, b: 42 };
  return { r: 147, g: 147, b: 152 };
};

const shade = (color: { r: number; g: number; b: number }, factor: number): number =>
  packRGBA(
    clamp255(color.r * factor),
    clamp255(color.g * factor),
    clamp255(color.b * factor),
    255,
  );

const normalizeQuat = (q: QuaternionLike): QuaternionLike => {
  const lenSq = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
  if (lenSq <= 0) {
    return { x: 0, y: 0, z: 0, w: 1 };
  }
  const inv = 1 / Math.sqrt(lenSq);
  return {
    x: q.x * inv,
    y: q.y * inv,
    z: q.z * inv,
    w: q.w * inv,
  };
};

const rotateByQuat = (q: QuaternionLike, v: Vec3): Vec3 => {
  const nx = q.x;
  const ny = q.y;
  const nz = q.z;
  const nw = q.w;

  const tx = 2 * (ny * v.z - nz * v.y);
  const ty = 2 * (nz * v.x - nx * v.z);
  const tz = 2 * (nx * v.y - ny * v.x);

  return {
    x: v.x + nw * tx + (ny * tz - nz * ty),
    y: v.y + nw * ty + (nz * tx - nx * tz),
    z: v.z + nw * tz + (nx * ty - ny * tx),
  };
};

const fillTriangle = (
  surface: ReturnType<typeof createSurface2D>,
  a: Vec2,
  b: Vec2,
  c: Vec2,
  color: number,
): void => {
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(surface.width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(surface.height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

  const edge = (p0: Vec2, p1: Vec2, p2: Vec2): number =>
    (p2.x - p0.x) * (p1.y - p0.y) - (p2.y - p0.y) * (p1.x - p0.x);

  const area = edge(a, b, c);
  if (Math.abs(area) < 0.0001) {
    return;
  }

  const sign = area > 0 ? 1 : -1;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p = { x: x + 0.5, y: y + 0.5 };
      const w0 = edge(b, c, p) * sign;
      const w1 = edge(c, a, p) * sign;
      const w2 = edge(a, b, p) * sign;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
        setPixel(surface, x, y, color);
      }
    }
  }
};

const drawLine = (
  surface: ReturnType<typeof createSurface2D>,
  a: Vec2,
  b: Vec2,
  color: number,
): void => {
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    setPixel(surface, x0, y0, color);
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
};

const glyphMap: Record<string, string[]> = {
  empty: [
    '1000001',
    '0100010',
    '0011100',
    '0001000',
    '0011100',
    '0100010',
    '1000001',
  ],
  attack: [
    '0001000',
    '0011100',
    '0111110',
    '0011100',
    '0011100',
    '0011100',
    '0011100',
  ],
  block: [
    '0111110',
    '0100010',
    '0100010',
    '0100010',
    '0100010',
    '0100010',
    '0111110',
  ],
  heal: [
    '0001000',
    '0001000',
    '1111111',
    '1111111',
    '0001000',
    '0001000',
    '0001000',
  ],
  mark: [
    '0011100',
    '0111110',
    '1111111',
    '1111111',
    '0111110',
    '0011100',
    '0001000',
  ],
  cleanse: [
    '1100011',
    '0110110',
    '0011100',
    '0001000',
    '0011100',
    '0110110',
    '1100011',
  ],
  swap: [
    '1110000',
    '0011000',
    '0001111',
    '0000110',
    '0111100',
    '0000110',
    '0001100',
  ],
  stun: [
    '1010101',
    '0111110',
    '1111111',
    '0111110',
    '1111111',
    '0111110',
    '1010101',
  ],
  focus: [
    '0011100',
    '0110110',
    '1100011',
    '1001001',
    '1100011',
    '0110110',
    '0011100',
  ],
  special: [
    '0011100',
    '0111110',
    '1101011',
    '1111111',
    '1101011',
    '0111110',
    '0011100',
  ],
};

const drawGlyph = (
  surface: ReturnType<typeof createSurface2D>,
  centerX: number,
  centerY: number,
  kind: DiceFaceDef['kind'],
  color: number,
): void => {
  const pattern = glyphMap[kind] ?? glyphMap.special;
  const scale = 2;
  const width = (pattern[0]?.length ?? 7) * scale;
  const height = pattern.length * scale;
  const startX = Math.round(centerX - width / 2);
  const startY = Math.round(centerY - height / 2);

  for (let y = 0; y < pattern.length; y += 1) {
    const row = pattern[y] ?? '';
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== '1') {
        continue;
      }
      fillRect(
        surface,
        startX + x * scale,
        startY + y * scale,
        scale,
        scale,
        color,
      );
    }
  }
};

const cubeVertices: Vec3[] = [
  { x: -1, y: -1, z: -1 },
  { x: 1, y: -1, z: -1 },
  { x: 1, y: 1, z: -1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
  { x: 1, y: -1, z: 1 },
  { x: 1, y: 1, z: 1 },
  { x: -1, y: 1, z: 1 },
];

type CubeFaceId = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
type CubeFaceDef = {
  id: CubeFaceId;
  verts: [number, number, number, number];
  normal: Vec3;
};

const cubeFaces: CubeFaceDef[] = [
  { id: '+x', verts: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
  { id: '-x', verts: [0, 3, 7, 4], normal: { x: -1, y: 0, z: 0 } },
  { id: '+y', verts: [3, 2, 6, 7], normal: { x: 0, y: 1, z: 0 } },
  { id: '-y', verts: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
  { id: '+z', verts: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
  { id: '-z', verts: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 } },
];

const lightDir: Vec3 = (() => {
  const x = -0.58;
  const y = 0.74;
  const z = 0.35;
  const inv = 1 / Math.hypot(x, y, z);
  return { x: x * inv, y: y * inv, z: z * inv };
})();

export const renderDiceCubeFrame = (
  canvas: HTMLCanvasElement,
  frame: DiceCubeRenderFrame,
): void => {
  const width = Math.max(32, canvas.width | 0);
  const height = Math.max(32, canvas.height | 0);
  let surface = surfaceCache.get(canvas);
  if (!surface || surface.width !== width || surface.height !== height) {
    surface = createSurface2D(width, height);
    surfaceCache.set(canvas, surface);
  }

  clearSurface(surface, packRGBA(0, 0, 0, 0));
  const q = normalizeQuat(frame.rotation);

  const cx = width * 0.5;
  const cy = height * 0.56;
  const scale = Math.min(width, height) * 0.34;
  const cameraZ = 4.2;

  const transformed = cubeVertices.map((vertex) => rotateByQuat(q, vertex));
  const projected = transformed.map((vertex) => {
    const depth = cameraZ + vertex.z;
    const inv = depth > 0.001 ? 1 / depth : 1;
    return {
      x: cx + vertex.x * scale * inv * cameraZ,
      y: cy - vertex.y * scale * inv * cameraZ,
      z: depth,
    };
  });

  const base = kindRgb(frame.face.kind);
  const outline = packRGBA(12, 14, 20, 255);

  const faceLayers = cubeFaces
    .map((face) => {
      const normal = rotateByQuat(q, face.normal);
      const avgZ =
        (projected[face.verts[0]].z +
          projected[face.verts[1]].z +
          projected[face.verts[2]].z +
          projected[face.verts[3]].z) /
        4;
      const lit = clamp01(normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z);
      return {
        face,
        normal,
        avgZ,
        visible: normal.z > -0.04,
        color: shade(base, 0.28 + lit * 0.9),
      };
    })
    .filter((entry) => entry.visible)
    .sort((a, b) => b.avgZ - a.avgZ);

  const upFace = faceLayers.slice().sort((a, b) => b.normal.y - a.normal.y)[0];

  const shadowAlpha = clamp01(frame.shadowAlpha ?? (frame.mode === 'physics_voxel' ? 0.42 : 0.34));
  const shadowW = Math.round(width * 0.46);
  const shadowH = Math.round(height * 0.14);
  const shadowColor = packRGBA(0, 0, 0, Math.round(255 * shadowAlpha));
  fillRect(
    surface,
    Math.round(cx - shadowW * 0.5),
    Math.round(cy + height * 0.23),
    shadowW,
    shadowH,
    shadowColor,
  );

  for (const layer of faceLayers) {
    const [a, b, c, d] = layer.face.verts;
    const pa = projected[a] as Vec2;
    const pb = projected[b] as Vec2;
    const pc = projected[c] as Vec2;
    const pd = projected[d] as Vec2;
    fillTriangle(surface, pa, pb, pc, layer.color);
    fillTriangle(surface, pa, pc, pd, layer.color);
    drawLine(surface, pa, pb, outline);
    drawLine(surface, pb, pc, outline);
    drawLine(surface, pc, pd, outline);
    drawLine(surface, pd, pa, outline);
  }

  if (upFace) {
    const points = upFace.face.verts.map((index) => projected[index] as Vec2);
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    drawGlyph(
      surface,
      centerX,
      centerY,
      frame.face.kind,
      packRGBA(236, 227, 205, 255),
    );
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  presentToCanvas(ctx, surface);
};
