import { createSaveRoute } from 'state-scenarios/next';

// Serves /__state-scenarios/save ("%5F" is "_"), so the panel can save into scenarios/.
// e2e points it outside the folder so tests don't touch the committed scenarios.
export const { GET } = createSaveRoute({ dir: process.env.STATE_SCENARIOS_SAVE_DIR ?? 'scenarios' });
