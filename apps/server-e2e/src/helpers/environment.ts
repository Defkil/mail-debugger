/** Plain child-process output without conflicting inherited color settings. */
export function childEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) environment[name] = value;
  }
  Object.assign(environment, overrides, { NO_COLOR: '1' });
  delete environment['FORCE_COLOR'];
  return environment;
}
