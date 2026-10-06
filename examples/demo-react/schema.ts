import { scenarioJsonSchema } from 'state-scenarios';
import { tanstackQueryState } from 'state-scenarios/tanstack-query';

/** The JSON Schema for this app's scenarios, including adapter state. */
export const demoJsonSchema = () => scenarioJsonSchema({ state: { 'tanstack-query': tanstackQueryState } });
