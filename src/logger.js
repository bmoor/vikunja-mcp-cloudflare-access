export function createLogger(write = console.log) {
  return {
    event(event, fields = {}) {
      // Deliberately accept only pre-sanitised operational fields. Tool inputs,
      // Vikunja responses, descriptions and authentication headers never enter
      // this logger.
      write(JSON.stringify({
        timestamp: new Date().toISOString(),
        service: 'vikunja-mcp',
        event,
        ...fields,
      }));
    },
  };
}
