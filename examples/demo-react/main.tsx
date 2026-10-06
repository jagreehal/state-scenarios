import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { type ScenarioInput, startScenarios } from 'state-scenarios';
import { mountPanel } from 'state-scenarios/panel';
import { tanstackQuery } from 'state-scenarios/tanstack-query';
import { App } from './App';
import { rules } from './rules';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const root = createRoot(document.getElementById('root')!);

try {
  // This demo has no backend, so it always mocks. A real app would guard with import.meta.env.DEV.
  const session = await startScenarios({
    scenarios: Object.values(
      import.meta.glob<ScenarioInput>('./scenarios/*.json', { eager: true, import: 'default' }),
    ),
    defaultScenario: 'default',
    adapters: [tanstackQuery(queryClient)],
    // Network-only switches happen in place: swap fixtures, then refetch.
    refresh: () => queryClient.resetQueries(),
    rules,
  });

  mountPanel(session);
  root.render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
} catch (err) {
  root.render(<pre className='fatal'>{String(err instanceof Error ? err.message : err)}</pre>);
}
