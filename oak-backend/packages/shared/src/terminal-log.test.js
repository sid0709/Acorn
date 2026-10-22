import {
  formatPlainLine,
  installTerminalLogger,
  parseStyledLine,
} from './terminal-log.js';

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

const line = formatPlainLine('INFO', 'athens', 'api', 'GET /api/foo 200', {
  durationMs: 12.3,
  status: 200,
});
assert(line.includes('level=INFO'), 'level field');
assert(line.includes('service=athens'), 'service field');
assert(line.includes('tag=api'), 'tag field');
assert(line.includes('msg='), 'msg field');
assert(!line.includes('\x1b'), 'no ANSI');
assert(/^\d{4}-\d{2}-\d{2}T/.test(line), 'ISO timestamp');

const parsed = parseStyledLine(line, 'athens');
assert(parsed.level === 'info', 'parsed level');
assert(parsed.tag === 'api', 'parsed tag');
assert(parsed.message.includes('GET /api/foo'), 'parsed message');

const originalLog = console.log;
const written = [];
console.log = (value) => written.push(value);
installTerminalLogger('athens');
console.log(line);
console.log = originalLog;
assert(written[0] === line, 'structured lines are not formatted twice');

console.log('terminal-log ok');
