import type { Frame } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { CliError } from './errors.js';

export type VideoFormat = 'mp4' | 'gif' | 'webm';

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of an element's box the video shows. Video holds only the viewport, so a crop must
 * stay inside it; `clipped` says the element was larger than the visible area.
 */
export function visibleCrop(box: Crop, viewport: { width: number; height: number; }) {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  const width = Math.min(viewport.width, box.x + box.width) - x;
  const height = Math.min(viewport.height, box.y + box.height) - y;

  if (width < 2 || height < 2) return undefined;

  return { crop: { x, y, width, height }, clipped: width < box.width || height < box.height };
}

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/**
 * ffmpeg arguments that trim the page load off the start, crop to an element, and encode.
 * MP4 is H.264 in yuv420p so it plays everywhere, including Safari and phones; GIF uses a
 * generated palette, which keeps it sharp at a fraction of the naive size.
 */
export function ffmpegArgs(
  { input, output, format, start, crop, fps, width }: {
    input: string;
    output: string;
    format: VideoFormat;
    /** Seconds to skip, e.g. the page loading before the steps begin. */
    start: number;
    crop?: Crop;
    /** Frames per second; GIFs default to 12. */
    fps?: number;
    /** Maximum output width in pixels, never upscaled; height follows the aspect ratio. */
    width?: number;
  },
): string[] {
  const rate = fps ?? (format === 'gif' ? 12 : undefined);

  // yuv420p needs even sizes.
  const filters = [
    crop && `crop=${even(crop.width)}:${even(crop.height)}:${Math.round(crop.x)}:${Math.round(crop.y)}`,
    rate && `fps=${rate}`,
    // Quoted so the comma in min() isn't read as a filter separator.
    width && `scale='trunc(min(${width},iw)/2)*2':-2:flags=lanczos`,
  ].filter(Boolean);

  const codec = {
    mp4: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-movflags', '+faststart'],
    webm: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32'],
    gif: [],
  }[format];

  const vf = format === 'gif'
    ? `${filters.join(',')},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`
    : filters.join(',');

  return [
    '-y',
    '-loglevel',
    'error',
    '-i',
    input,
    '-ss',
    start.toFixed(2),
    ...(vf ? ['-vf', vf] : []),
    '-an',
    ...codec,
    output,
  ];
}

/**
 * Convert Playwright's WebM into the requested format. WebM without a crop, --fps or --width is
 * copied as recorded (page load included), so it works without ffmpeg.
 */
export function encodeVideo(options: Parameters<typeof ffmpegArgs>[0]) {
  if (options.format === 'webm' && !options.crop && !options.fps && !options.width) {
    copyFileSync(options.input, options.output);

    return { start: 0 };
  }

  // FFMPEG_PATH is the usual override when ffmpeg isn't on PATH (common on Windows).
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const result = spawnSync(ffmpeg, ffmpegArgs(options), { encoding: 'utf8' });

  if (result.error) {
    throw new CliError(
      'FFMPEG_MISSING',
      `record needs ffmpeg for ${options.format}${
        options.format === 'webm' ? ' with --element, --fps or --width' : ''
      }: install it (https://ffmpeg.org/download.html) or set FFMPEG_PATH`,
    );
  }

  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`);

  return { start: options.start };
}

/** The video size ffmpeg writes: the crop or viewport, capped at `width` as the scale filter does. */
export function outputSize(source: { width: number; height: number; }, width?: number) {
  if (!width) return source;

  const w = Math.trunc(Math.min(width, source.width) / 2) * 2;

  return { width: w, height: Math.round((w * source.height) / (source.width * 2)) * 2 };
}

/**
 * What `<name>.video.json` holds next to each video, so video editors such as Remotion can size
 * a composition, title it and zoom to clicks. Times are ms into the saved video; click positions
 * are pixels in it.
 */
export function videoManifest(
  { name, description, video, viewport, crop, width, start, end, clicks }: {
    name: string;
    description?: string;
    video: string;
    viewport: { width: number; height: number; };
    crop?: Crop;
    width?: number;
    /** Epoch ms where the saved video begins and ends. */
    start: number;
    end: number;
    /** Epoch ms and page coordinates of each pointerdown, and of each field taking focus. */
    clicks: { at: number; x: number; y: number; kind?: 'focus'; }[];
  },
) {
  const source = crop
    ? { ...crop, width: even(crop.width), height: even(crop.height) }
    : { x: 0, y: 0, ...viewport };

  const size = outputSize({ width: source.width, height: source.height }, width);
  const ratio = size.width / source.width;

  return {
    name,
    description,
    video,
    width: size.width,
    height: size.height,
    durationMs: Math.round(end - start),
    clicks: clicks
      .map((c) => ({
        t: Math.round(c.at - start),
        x: Math.round((c.x - Math.round(source.x)) * ratio),
        y: Math.round((c.y - Math.round(source.y)) * ratio),
        ...(c.kind && { kind: c.kind }),
      }))
      .filter((c) => c.t >= 0 && c.x >= 0 && c.y >= 0 && c.x < size.width && c.y < size.height),
  };
}

/**
 * A point in a frame, in page coordinates, so a click inside an iframe maps to the video.
 * Playwright measures the iframe element on the page, CSS transforms included; comparing that with
 * its layout size gives the scale for the border, padding and the point itself. Scales and
 * translations map exactly; a rotated or skewed iframe maps to its bounding box.
 */
export async function pagePoint(frame: Frame, x: number, y: number) {
  if (!frame.parentFrame()) return { x, y };

  const element = await frame.frameElement();

  const [box, layout] = await Promise.all([
    element.boundingBox(),
    element.evaluate((node) => {
      // frameElement() returns the <iframe> or <frame> element, so this always passes.
      if (!(node instanceof HTMLElement)) return undefined;

      const style = getComputedStyle(node);

      return {
        left: node.clientLeft + parseFloat(style.paddingLeft),
        top: node.clientTop + parseFloat(style.paddingTop),
        width: node.offsetWidth,
        height: node.offsetHeight,
      };
    }),
  ]);

  if (!box || !layout?.width || !layout.height) throw new Error('The iframe is not visible');

  const scaleX = box.width / layout.width;
  const scaleY = box.height / layout.height;

  return { x: box.x + (layout.left + x) * scaleX, y: box.y + (layout.top + y) * scaleY };
}
