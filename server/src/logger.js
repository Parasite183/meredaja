// Minimal structured logger (Zemen pattern, trimmed to what we use).
const emit = (level, event, fields = {}) => {
  const line = { level, event, ...fields, at: new Date().toISOString() };
  if (level === 'error') console.error(JSON.stringify(line));
  else if (level === 'warn') console.warn(JSON.stringify(line));
  else console.log(JSON.stringify(line));
};

export const logger = {
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields),
};
