const ts = () => new Date().toISOString().slice(11, 23);

export const log = {
  info: (...a: unknown[]) => console.log(`\x1b[2m${ts()}\x1b[0m`, ...a),
  warn: (...a: unknown[]) => console.warn(`\x1b[2m${ts()}\x1b[0m \x1b[33mwarn\x1b[0m`, ...a),
  error: (...a: unknown[]) => console.error(`\x1b[2m${ts()}\x1b[0m \x1b[31merror\x1b[0m`, ...a),
  market: (...a: unknown[]) => console.log(`\x1b[2m${ts()}\x1b[0m \x1b[35mmarket\x1b[0m`, ...a),
};
