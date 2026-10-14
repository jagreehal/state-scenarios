import { AbsoluteFill, interpolate, Series, useCurrentFrame, useVideoConfig } from 'remotion';
import { ScenarioClip, type VideoManifest } from './ScenarioClip';

export type PromoProps = {
  title: string;
  /** Scenarios in order, recorded into public/clips by `pnpm clips`. The caption defaults to the description. */
  scenarios: { name: string; caption?: string; }[];
  /** Filled in by calculateMetadata from each scenario's manifest. */
  clips: VideoManifest[];
};

export const TITLE_SECONDS = 1.5;

/** Frames a clip plays for: the whole recording. */
export const clipFrames = (clip: VideoManifest, fps: number) => Math.ceil((clip.durationMs / 1000) * fps);

const Title = ({ text }: { text: string; }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
      <h1
        style={{
          color: 'white',
          font: '700 84px system-ui, sans-serif',
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], { extrapolateRight: 'clamp' }),
          translate: `0 ${interpolate(frame, [0, 0.5 * fps], [24, 0], { extrapolateRight: 'clamp' })}px`,
        }}
      >
        {text}
      </h1>
    </AbsoluteFill>
  );
};

export const Promo = ({ title, clips }: PromoProps) => {
  const { fps } = useVideoConfig();

  return (
    <Series>
      <Series.Sequence durationInFrames={Math.round(TITLE_SECONDS * fps)}>
        <Title text={title} />
      </Series.Sequence>
      {clips.map((clip) => (
        <Series.Sequence key={clip.name} durationInFrames={clipFrames(clip, fps)}>
          <ScenarioClip clip={clip} />
        </Series.Sequence>
      ))}
    </Series>
  );
};
