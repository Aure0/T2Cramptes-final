export interface SpriteBitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

const PIXEL_RATIO = 2;

export function getVehicleBadgeImageId(
  shortName: string,
  routeColor: string,
  routeTextColor: string,
  isSelected: boolean
): string {
  const cleanBg = routeColor.replace(/[^a-zA-Z0-9]/g, '');
  const cleanFg = routeTextColor.replace(/[^a-zA-Z0-9]/g, '');
  return `t2c-veh-badge:${shortName}:${cleanBg}:${cleanFg}:${isSelected ? '1' : '0'}`;
}

export function getVehicleArrowImageId(isSelected: boolean): string {
  return isSelected ? 't2c-veh-arrow:selected' : 't2c-veh-arrow:normal';
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Renders a crisp 2x HiDPI rounded pill/circle vehicle badge sprite for MapLibre WebGL symbol layers.
 */
export function renderVehicleBadgeSprite(
  shortName: string,
  routeColor: string,
  routeTextColor: string,
  isSelected: boolean
): SpriteBitmap | null {
  if (typeof document === 'undefined') return null;

  const scale = isSelected ? 1.18 : 1.0;
  const charLen = shortName.length;
  const pillWidthCss = Math.round((charLen <= 1 ? 24 : charLen === 2 ? 28 : 34) * scale);
  const pillHeightCss = Math.round(24 * scale);
  const padCss = isSelected ? 8 : 6;
  const totalW = (pillWidthCss + padCss * 2) * PIXEL_RATIO;
  const totalH = (pillHeightCss + padCss * 2) * PIXEL_RATIO;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  const x = padCss;
  const y = padCss;
  const radius = pillHeightCss / 2;

  // Soft drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.58)';
  ctx.shadowBlur = isSelected ? 7 : 5;
  ctx.shadowOffsetY = 2;

  // Outer selection cyan ring
  if (isSelected) {
    drawRoundedRectPath(ctx, x - 3.5, y - 3.5, pillWidthCss + 7, pillHeightCss + 7, radius + 3.5);
    ctx.fillStyle = '#38BDF8';
    ctx.fill();
  }

  // Dark contrast halo border
  drawRoundedRectPath(ctx, x - 1.8, y - 1.8, pillWidthCss + 3.6, pillHeightCss + 3.6, radius + 1.8);
  ctx.fillStyle = '#0B0F17';
  ctx.fill();
  ctx.restore();

  // Official T2C route badge fill
  drawRoundedRectPath(ctx, x, y, pillWidthCss, pillHeightCss, radius);
  ctx.fillStyle = routeColor;
  ctx.fill();

  // Crisp line label
  ctx.fillStyle = routeTextColor;
  const fontSize = Math.round((charLen >= 3 ? 10 : 11) * scale);
  ctx.font = `700 ${fontSize}px "Space Grotesk", "Inter", system-ui, -apple-system, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shortName, x + pillWidthCss / 2, y + pillHeightCss / 2 + 0.5);

  const imageData = ctx.getImageData(0, 0, totalW, totalH);
  return {
    width: totalW,
    height: totalH,
    data: new Uint8Array(imageData.data.buffer),
  };
}

/**
 * Renders a 2x HiDPI centered directional heading arrow sprite that orbits the vehicle badge
 * smoothly when MapLibre rotates it via GPU `icon-rotate`.
 */
export function renderVehicleArrowSprite(isSelected: boolean): SpriteBitmap | null {
  if (typeof document === 'undefined') return null;

  const sizeCss = isSelected ? 52 : 44;
  const total = sizeCss * PIXEL_RATIO;
  const canvas = document.createElement('canvas');
  canvas.width = total;
  canvas.height = total;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  const cx = sizeCss / 2;
  const tipY = 2;
  const baseY = isSelected ? 10.5 : 9.5;
  const halfW = isSelected ? 5.2 : 4.6;

  ctx.beginPath();
  ctx.moveTo(cx, tipY);
  ctx.lineTo(cx + halfW, baseY);
  ctx.lineTo(cx - halfW, baseY);
  ctx.closePath();

  ctx.fillStyle = isSelected ? '#38BDF8' : '#F8FAFC';
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#050810';
  ctx.stroke();

  const imageData = ctx.getImageData(0, 0, total, total);
  return {
    width: total,
    height: total,
    data: new Uint8Array(imageData.data.buffer),
  };
}
