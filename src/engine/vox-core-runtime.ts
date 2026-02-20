import { clearSurface, createSurface2D, presentToCanvas, type Surface2D } from '@voxelyn/core';

export interface IsoCameraParams {
  originX: number;
  originY: number;
  zoom: number;
  tileW: number;
  tileH: number;
  zStep: number;
}

export interface IsoNode {
  id: string;
  x: number;
  y: number;
  z: number;
  visible: boolean;
}

const defaultCamera = (width: number, height: number): IsoCameraParams => ({
  originX: Math.floor(width * 0.5),
  originY: Math.floor(height * 0.4),
  zoom: 1,
  tileW: 16,
  tileH: 8,
  zStep: 6,
});

export class IsoRuntime {
  public readonly surface: Surface2D;

  public readonly nodes = new Map<string, IsoNode>();

  public readonly camera: IsoCameraParams;

  private readonly ctx: CanvasRenderingContext2D;

  private disposed = false;

  private timeMs = 0;

  public constructor(canvas: HTMLCanvasElement, width?: number, height?: number) {
    const finalWidth = Math.max(64, width ?? canvas.width ?? 320);
    const finalHeight = Math.max(64, height ?? canvas.height ?? 180);

    canvas.width = finalWidth;
    canvas.height = finalHeight;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Nao foi possivel criar CanvasRenderingContext2D para IsoRuntime.');
    }

    this.ctx = ctx;
    this.surface = createSurface2D(finalWidth, finalHeight);
    this.camera = defaultCamera(finalWidth, finalHeight);
  }

  public upsertNode(node: Pick<IsoNode, 'id'> & Partial<Omit<IsoNode, 'id'>>): IsoNode {
    const current = this.nodes.get(node.id);
    const next: IsoNode = {
      id: node.id,
      x: node.x ?? current?.x ?? 0,
      y: node.y ?? current?.y ?? 0,
      z: node.z ?? current?.z ?? 0,
      visible: node.visible ?? current?.visible ?? true,
    };

    this.nodes.set(next.id, next);
    return next;
  }

  public removeNode(id: string): void {
    this.nodes.delete(id);
  }

  public update(dtMs: number): void {
    if (this.disposed) {
      return;
    }

    this.timeMs += Math.max(0, dtMs);

    // Runtime wrapper intentionally keeps core presentation simple for current DOM-first UI.
    const pulse = Math.floor(8 * Math.sin(this.timeMs / 900));
    const base = 0x121a24ff + (pulse << 8);
    clearSurface(this.surface, base >>> 0);
    presentToCanvas(this.ctx, this.surface);
  }

  public dispose(): void {
    this.disposed = true;
    this.nodes.clear();
  }
}
