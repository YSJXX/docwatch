import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../bin/cli-args.mjs';

describe('parseArgs', () => {
  it('defaults to cwd, port 4321, open true', () => {
    expect(parseArgs([], '/cur')).toEqual({ target: '/cur', port: 4321, open: true, host: undefined });
  });

  it('resolves relative target paths', () => {
    expect(parseArgs(['./proj'], '/cur').target).toBe('/cur/proj');
  });

  it('parses --port and --no-open', () => {
    expect(parseArgs(['--port', '5000', '--no-open'], '/c')).toMatchObject({ port: 5000, open: false });
  });

  it('parses --host', () => {
    expect(parseArgs(['--host', '0.0.0.0'], '/c')).toMatchObject({ host: '0.0.0.0' });
  });

  it('leaves host undefined when --host is absent', () => {
    expect(parseArgs([], '/c').host).toBeUndefined();
  });

  it.each(['abc', '-1', '0', '70000'])('rejects invalid --port value %s', (value) => {
    expect(() => parseArgs(['--port', value], '/c')).toThrow(/Invalid --port/);
  });

  it('rejects missing --port value', () => {
    expect(() => parseArgs(['--port'], '/c')).toThrow(/Missing value for --port/);
  });

  it('rejects missing --host value', () => {
    expect(() => parseArgs(['--host'], '/c')).toThrow(/Missing value for --host/);
  });
});
