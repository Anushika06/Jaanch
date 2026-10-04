import sharp from 'sharp';

export interface ImageTile {
  dataUrl: string;
  bytes: number;
}

/**
 * Prepare a screenshot for a vision model with an inline-size budget. Text legibility matters
 * more than colour, so images are converted to greyscale JPEG; tall phone screenshots are split
 * into overlapping tiles instead of being shrunk until the text is unreadable.
 */
export async function prepareImageTiles(
  bytes: Uint8Array,
  opts: {
    maxInlineBytes: number;
    maxWidth?: number;
    tileHeight?: number;
    overlap?: number;
    maxTiles?: number;
  } = { maxInlineBytes: 180_000 },
): Promise<ImageTile[]> {
  const maxWidth = opts.maxWidth ?? 1080;
  const tileHeight = opts.tileHeight ?? 1400;
  const overlap = opts.overlap ?? 120;
  const maxTiles = opts.maxTiles ?? 4;

  const base = sharp(bytes)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .greyscale();
  const { data, info } = await base.png().toBuffer({ resolveWithObject: true });
  const height = info.height;
  const width = info.width;

  // Very long scroll-captures get taller tiles rather than losing their bottom part.
  const effectiveTile = Math.max(tileHeight, Math.ceil((height - overlap) / maxTiles) + overlap);
  const tops: number[] = [];
  if (height <= effectiveTile) tops.push(0);
  else
    for (
      let top = 0;
      top < height - overlap && tops.length < maxTiles;
      top += effectiveTile - overlap
    )
      tops.push(Math.min(top, Math.max(0, height - effectiveTile)));

  const tiles: ImageTile[] = [];
  for (const top of [...new Set(tops)]) {
    const h = Math.min(effectiveTile, height - top);
    let quality = 82;
    let scale = 1;
    let out: Buffer = Buffer.alloc(0);
    // Reduce quality first, then size, until the base64 payload fits the inline budget.
    for (let i = 0; i < 8; i++) {
      out = await sharp(data)
        .extract({ left: 0, top, width, height: h })
        .resize({ width: Math.round(width * scale) })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (Math.ceil(out.length / 3) * 4 <= opts.maxInlineBytes) break;
      if (quality > 55) quality -= 9;
      else scale *= 0.85;
    }
    tiles.push({ dataUrl: `data:image/jpeg;base64,${out.toString('base64')}`, bytes: out.length });
  }
  return tiles;
}
