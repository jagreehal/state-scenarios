import { type CalculateMetadataFunction, Composition, staticFile } from 'remotion';
import { clipFrames, Promo, type PromoProps, TITLE_SECONDS } from './Promo';
import type { VideoManifest } from './ScenarioClip';

const FPS = 30;

/** Read each scenario's manifest, then size the video to the title plus every clip. */
const calculateMetadata: CalculateMetadataFunction<PromoProps> = async ({ props }) => {
  const clips = await Promise.all(
    props.scenarios.map(async ({ name, caption }): Promise<VideoManifest> => {
      const response = await fetch(staticFile(`clips/${name}.video.json`));

      if (!response.ok) throw new Error(`No clip for "${name}". Run \`pnpm clips\` first.`);

      const manifest: VideoManifest = await response.json();

      return { ...manifest, description: caption ?? manifest.description };
    }),
  );

  return {
    durationInFrames: Math.round(TITLE_SECONDS * FPS) + clips.reduce((n, c) => n + clipFrames(c, FPS), 0),
    props: { ...props, clips },
  };
};

export const Root = () => (
  <Composition
    id='Promo'
    component={Promo}
    fps={FPS}
    width={1280}
    height={720}
    durationInFrames={1}
    defaultProps={{
      title: 'Who speaks what',
      scenarios: [
        { name: 'default', caption: 'Filter 248 countries by region and language' },
        { name: 'twenty-one-countries', caption: 'Page through the results' },
        { name: 'server-error', caption: 'Retry when the API is busy' },
      ],
      clips: [],
    }}
    calculateMetadata={calculateMetadata}
  />
);
