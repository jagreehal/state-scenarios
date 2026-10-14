import { Video } from '@remotion/media';
import { AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { type Click, zoomAt } from './zoom';

/** What `state-scenarios record` writes to `<name>.video.json` next to each video. */
export interface VideoManifest {
  name: string;
  description?: string;
  video: string;
  width: number;
  height: number;
  durationMs: number;
  clicks: Click[];
}

/** One recorded scenario: the video as a card, zooming to each click, captioned with its description. */
export const ScenarioClip = ({ clip }: { clip: VideoManifest; }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const fit = Math.min((width * 0.86) / clip.width, (height * 0.78) / clip.height);
  const camera = zoomAt(clip.clicks, (frame / fps) * 1000);

  return (
    <AbsoluteFill style={{ background: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: clip.width * fit,
          height: clip.height * fit,
          marginBottom: height * 0.08,
          overflow: 'hidden',
          borderRadius: 16,
          boxShadow: '0 30px 80px rgba(0,0,0,.45)',
        }}
      >
        <Video
          src={staticFile(`clips/${clip.video}`)}
          muted
          style={{
            width: '100%',
            height: '100%',
            scale: camera.scale,
            transformOrigin: `${(camera.x / clip.width) * 100}% ${(camera.y / clip.height) * 100}%`,
          }}
        />
      </div>
      <p
        style={{
          position: 'absolute',
          bottom: height * 0.05,
          margin: 0,
          color: 'white',
          font: '600 34px system-ui, sans-serif',
          opacity: interpolate(frame, [0, 0.4 * fps], [0, 1], { extrapolateRight: 'clamp' }),
        }}
      >
        {clip.description ?? clip.name}
      </p>
    </AbsoluteFill>
  );
};
