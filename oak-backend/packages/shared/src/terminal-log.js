/**
 * Plain structured terminal logging for NextOffer services.
 * ISO-8601 timestamps, key=value fields, no ANSI colors or icons.
 */

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const STRUCTURED_LINE_RE =
  /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+level=(?:INFO|WARN|ERROR)\s/;

/** @deprecated Kept for dev-dashboard compatibility — no longer used for styling. */
export const TAG_COLORS = {};

/** @deprecated Kept for dev-dashboard compatibility — no longer used for styling. */
export const LEVEL_STYLES = {
  info: { icon: '●', color: '' },
  warn: { icon: '▲', color: '' },
  error: { icon: '✖', color: '' },
};

export function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
}

function isoTimestamp() {
  return new Date().toISOString();
}

function stringifyArg(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

function quoteValue(value) {
  const s = String(value ?? '');
  if (s === '') return '""';
  if (/[\s="\\]/.test(s))
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return s;
}

/**
 * @param {Record<string, unknown>} fields
 */
export function formatFields(fields = {}) {
  const parts = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${quoteValue(value)}`);
  }
  return parts.join(' ');
}

/**
 * @param {'INFO' | 'WARN' | 'ERROR'} level
 * @param {string} service
 * @param {string} tag
 * @param {string} msg
 * @param {Record<string, unknown>} [extra]
 */
export function formatPlainLine(level, service, tag, msg, extra = {}) {
  const base = [
    isoTimestamp(),
    `level=${level}`,
    `service=${quoteValue(service || 'app')}`,
    `tag=${quoteValue(tag || 'app')}`,
  ];
  const extraStr = formatFields(extra);
  if (extraStr) base.push(extraStr);
  if (msg) base.push(`msg=${quoteValue(msg)}`);
  return base.join(' ');
}

/**
 * @param {string} text
 * @returns {{ tag: string | null, body: string }}
 */
export function extractBracketTag(text) {
  if (typeof text !== 'string') return { tag: null, body: stringifyArg(text) };
  const match = text.match(/^\[([^\]]+)\]\s*(.*)$/s);
  if (match) return { tag: match[1], body: match[2] || '' };
  return { tag: null, body: text };
}

/**
 * @param {'info' | 'warn' | 'error'} level
 * @param {unknown[]} args
 * @param {string} [service]
 */
export function formatLogLine(level, args, service = '') {
  const levelUpper =
    level === 'warn' ? 'WARN' : level === 'error' ? 'ERROR' : 'INFO';
  const first = args[0];
  let tag = 'app';
  let bodyParts = [];

  if (typeof first === 'string') {
    const parsed = extractBracketTag(first);
    if (parsed.tag) tag = parsed.tag;
    if (parsed.body) bodyParts.push(parsed.body);
    bodyParts.push(...args.slice(1).map(stringifyArg));
  } else {
    bodyParts = args.map(stringifyArg);
  }

  const message = bodyParts.filter((part) => part !== '').join(' ');
  return formatPlainLine(levelUpper, service, tag, message);
}

/**
 * Parse a plain log line (key=value format).
 * @param {string} line
 * @param {string} [serviceName]
 */
export function parseStyledLine(line, serviceName = '') {
  const plain = stripAnsi(line).trim();
  if (!plain) {
    return {
      time: '',
      level: 'info',
      tag: serviceName || 'app',
      message: '',
      service: serviceName,
    };
  }

  // New format: 2025-07-07T17:30:45.123Z level=INFO service=athens tag=api msg="..."
  const isoMatch = plain.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s/);
  if (isoMatch) {
    const fields = {};
    const fieldRe = /(\w+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
    let match;
    const rest = plain.slice(isoMatch[0].length);
    while ((match = fieldRe.exec(rest)) !== null) {
      let val = match[2];
      if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      fields[match[1]] = val;
    }
    const levelRaw = String(fields.level || 'INFO').toLowerCase();
    const level =
      levelRaw === 'warn' ? 'warn' : levelRaw === 'error' ? 'error' : 'info';
    return {
      time: isoMatch[1],
      level,
      tag: fields.tag || serviceName || 'app',
      message: fields.msg || '',
      service: fields.service || serviceName,
    };
  }

  // Legacy bracket format fallback
  const bracket = extractBracketTag(plain);
  return {
    time: isoTimestamp(),
    level:
      plain.toLowerCase().includes('error') ||
      plain.toLowerCase().includes('failed')
        ? 'error'
        : 'info',
    tag: bracket.tag || serviceName || 'app',
    message: bracket.tag ? bracket.body : plain,
    service: serviceName,
  };
}

/**
 * @param {string} [service]
 */
export function installTerminalLogger(service = '') {
  if (process.env.NO_TERMINAL_LOGGER === '1') return;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const wrap =
    (level, output) =>
    (...args) => {
      // Structured loggers already include the timestamp, level and service.
      // Passing them through formatLogLine again creates nested, unreadable logs.
      if (
        args.length === 1 &&
        typeof args[0] === 'string' &&
        STRUCTURED_LINE_RE.test(args[0])
      ) {
        output(args[0]);
        return;
      }
      output(formatLogLine(level, args, service));
    };

  console.log = wrap('info', original.log);
  console.info = wrap('info', original.info);
  console.warn = wrap('warn', original.warn);
  console.error = wrap('error', original.error);
}

/**
 * @param {string} service
 */
export function createLogger(service) {
  const write = (level, tag, msg, extra = {}) => {
    const levelUpper =
      level === 'warn' ? 'WARN' : level === 'error' ? 'ERROR' : 'INFO';
    const line = formatPlainLine(levelUpper, service, tag, msg, extra);
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  return {
    info: (tag, msg, extra) => write('info', tag, msg, extra),
    warn: (tag, msg, extra) => write('warn', tag, msg, extra),
    error: (tag, msg, extra) => write('error', tag, msg, extra),
    llm: (fields) => {
      const {
        msg = 'chat completed',
        feature,
        provider,
        requestedModel,
        billedModel,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costUsd,
        durationMs,
        runId,
        applierName,
        requestId,
        ...rest
      } = fields;
      write('info', 'llm', msg, {
        feature,
        provider,
        requestedModel,
        billedModel,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        costUsd,
        durationMs,
        runId,
        applierName,
        requestId,
        ...rest,
      });
    },
  };
}

export function printBanner(title, lines = []) {
  console.log(`=== ${title} ===`);
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

/**
 * Express middleware: logs failed and slow request outcomes once.
 * Set LOG_HTTP_SUCCESS=1 to include ordinary successful requests.
 * @param {string} [tag]
 */
export function requestLogger(tag = 'api') {
  return function requestLoggerMiddleware(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const service = process.env.LOG_SERVICE || 'app';
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      if (res.locals?.suppressRequestLog === true) return;
      const slowRequestMs = Number(process.env.LOG_HTTP_SLOW_MS || 1000);
      const logSuccessful = process.env.LOG_HTTP_SUCCESS === '1';
      if (res.statusCode < 400 && !logSuccessful && ms < slowRequestMs) return;
      const level =
        res.statusCode >= 500
          ? 'ERROR'
          : res.statusCode >= 400
            ? 'WARN'
            : 'INFO';
      const path = req.originalUrl?.split('?')[0] || req.path || '/';
      const line = formatPlainLine(
        level,
        service,
        tag,
        `${req.method} ${path} ${res.statusCode} ${Math.round(ms)}ms`,
      );
      if (level === 'ERROR') console.error(line);
      else if (level === 'WARN') console.warn(line);
      else console.log(line);
    });
    next();
  };
}
