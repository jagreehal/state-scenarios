import { createRoot } from 'react-dom/client';
import { type ScenarioInput, startScenarios } from 'state-scenarios';
import { cookiesAdapter } from 'state-scenarios/cookies';
import { mountPanel } from 'state-scenarios/panel';
import { App } from './App';

// Without ?scenario= the app talks to the stand-in backend; add ?scenario-record to record it.
mountPanel(
  await startScenarios({
    scenarios: Object.values(
      import.meta.glob<ScenarioInput>('./scenarios/*.json', { eager: true, import: 'default' }),
    ),
    adapters: [cookiesAdapter()],
  }),
);

createRoot(document.getElementById('root')!).render(<App />);
