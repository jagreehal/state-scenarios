import type { Frame, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { z } from 'zod';
import { CliError } from './errors.js';

declare global {
  interface Window {
    /** Set by record: reports each pointerdown, and each field taking focus, for the video's manifest. */
    stateScenariosClick(x: number, y: number, kind?: 'focus', cover?: number): void;
  }
}

/**
 * Init script for record: reports each pointerdown, and each field taking focus, to
 * `window.stateScenariosClick` for the video's manifest. Runs in the browser, so it stays self-contained.
 */
export function reportPoints() {
  let pressed: { x: number; y: number; t: number; } | undefined;

  // Share of the page an element covers, so a video skips zooming to a big one. Not inside an iframe.
  const cover = (el: EventTarget | null) => {
    if (!(el instanceof Element) || top !== self) return undefined;

    const r = el.getBoundingClientRect();

    return Math.min(1, (r.width * r.height) / (innerWidth * innerHeight));
  };

  addEventListener('pointerdown', (e) => {
    pressed = { x: e.clientX, y: e.clientY, t: performance.now() };
    window.stateScenariosClick(e.clientX, e.clientY, undefined, cover(e.target));
  }, true);
  // The glide before fill() moves the mouse, so the field's own point applies.
  addEventListener('pointermove', () => pressed = undefined, true);
  // A field taking focus is about to be typed into, so editors hold the camera on it.
  // Focus from a click keeps the click's point; fill() focuses where the glide put the mouse.
  addEventListener('focusin', (e) => {
    const field = e.target;

    if (
      !(field instanceof Element)
      || !field.matches(
        'textarea, select, [contenteditable]:not([contenteditable=false]), input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio], [type=file], [type=image], [type=range], [type=color])',
      )
    ) return;

    if (pressed && performance.now() - pressed.t < 500) {
      window.stateScenariosClick(pressed.x, pressed.y, 'focus', cover(field));

      return;
    }

    // A popup (a combobox's search, a command palette) focuses its field before it's positioned,
    // parked off-screen until it measures itself: read the box a couple of frames later, and
    // never point off-screen.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const box = field.getBoundingClientRect();

        if (document.activeElement !== field) return;

        if (box.bottom < 0 || box.right < 0 || box.top > innerHeight || box.left > innerWidth) return;

        window.stateScenariosClick(
          box.left + Math.min(24, box.width / 2),
          box.top + box.height / 2,
          'focus',
          cover(field),
        );
      })
    );
  }, true);
}

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

/** The size a viewport's video is saved at: even, as yuv420p needs. ffmpeg scales Chrome's recording to it. */
export const videoSize = (viewport: { width: number; height: number; }) => ({
  width: even(viewport.width),
  height: even(viewport.height),
});

/**
 * ffmpeg arguments that crop to an element and encode.
 * MP4 is H.264 in yuv420p so it plays everywhere, including Safari and phones; GIF uses a
 * generated palette, which keeps it sharp at a fraction of the naive size.
 */
export function ffmpegArgs(
  { input, output, format, size, duration, crop, fps, width }: {
    input: string;
    output: string;
    format: VideoFormat;
    /** From `videoSize`. Chrome shrinks odd viewports keeping their aspect ratio (1279x719 records at 1276x718), so the recording is scaled back to this before cropping. */
    size: { width: number; height: number; };
    /** Seconds recorded. Chrome only writes a frame when the page changes, so the last one is held to here. */
    duration: number;
    crop?: Crop;
    /** Frames per second; GIFs default to 12, video to 60. */
    fps?: number;
    /** Maximum output width in pixels, never upscaled; height follows the aspect ratio. */
    width?: number;
  },
): string[] {
  const rate = fps ?? (format === 'gif' ? 12 : 60);

  // yuv420p needs even sizes.
  const filters = [
    `scale=${size.width}:${size.height}`,
    crop && `crop=${even(crop.width)}:${even(crop.height)}:${Math.round(crop.x)}:${Math.round(crop.y)}`,
    // A constant rate, then the last frame held, so `-t` cuts the video at the recorded length.
    `fps=${rate}`,
    `tpad=stop_mode=clone:stop_duration=${duration.toFixed(3)}`,
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
    '-vf',
    vf,
    '-t',
    duration.toFixed(3),
    '-an',
    ...codec,
    output,
  ];
}

/**
 * The ffmpeg to run: FFMPEG_PATH, then `@ffmpeg-installer/ffmpeg` when the project has it
 * (prebuilt for macOS, Windows and Linux, so nothing to install system-wide), then PATH.
 */
export function ffmpegPath(env = process.env, cwd = process.cwd()) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;

  try {
    const installed: unknown = createRequire(join(cwd, 'package.json'))('@ffmpeg-installer/ffmpeg');

    return z.object({ path: z.string() }).parse(installed).path;
  } catch {
    return 'ffmpeg';
  }
}

/**
 * Records the page from now on with Chrome's own encoder (CDP `Page.startScreenRecording`,
 * Chromium 153+): AV1 at up to 60fps, sized to the viewport so crops in CSS pixels line up.
 * The returned function stops and writes the MP4 to `file`.
 */
export async function startRecording(page: Page, viewport: { width: number; height: number; }) {
  const session = await page.context().newCDPSession(page);

  await session.send('Page.startScreenRecording', {
    frameRate: 60,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
  });

  return async (file: string) => {
    const { stream: handle } = await session.send('Page.stopScreenRecording');
    const chunks: Buffer[] = [];

    try {
      for (let eof = false; !eof;) {
        const chunk = await session.send('IO.read', { handle });
        chunks.push(Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8'));
        eof = chunk.eof;
      }
    } finally {
      await session.send('IO.close', { handle }).catch(() => {});
    }

    writeFileSync(file, Buffer.concat(chunks));
  };
}

/** Convert Chrome's AV1 recording into the requested format. */
export function encodeVideo(options: Parameters<typeof ffmpegArgs>[0]) {
  const result = spawnSync(ffmpegPath(), ffmpegArgs(options), { encoding: 'utf8' });

  if (result.error) {
    throw new CliError(
      'FFMPEG_MISSING',
      'record needs ffmpeg: run `npm i -D @ffmpeg-installer/ffmpeg` in this project, or set FFMPEG_PATH',
    );
  }

  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr.trim()}`);
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
    clicks: { at: number; x: number; y: number; kind?: 'focus'; cover?: number; }[];
  },
) {
  const source = crop
    ? { ...crop, width: even(crop.width), height: even(crop.height) }
    : { x: 0, y: 0, ...viewport };

  const size = outputSize({ width: source.width, height: source.height }, width);
  const ratio = size.width / source.width;
  // `cover` is measured against the page; a crop shows less of it, so the element covers more of the video.
  const zoomIn = (viewport.width * viewport.height) / (source.width * source.height);

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
        ...(c.cover !== undefined && { cover: Math.round(Math.min(1, c.cover * zoomIn) * 1000) / 1000 }),
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
