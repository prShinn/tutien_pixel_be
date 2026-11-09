const { timingSafeEqual } = require('node:crypto');
const { monitorEventLoopDelay } = require('node:perf_hooks');

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function numberValue(value) {
  return Number.isFinite(value) ? String(value) : '0';
}

function createPrometheusMetrics({ token = '' } = {}) {
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  const httpRequests = new Map();

  function start() {
    eventLoopDelay.enable();
  }

  function close() {
    eventLoopDelay.disable();
  }

  function observeRequest({ method, route, status, durationSeconds }) {
    const safeMethod = ALLOWED_METHODS.has(method) ? method : 'OTHER';
    const safeRoute = typeof route === 'string' && route.length <= 160 ? route : 'unmatched';
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : '0';
    const duration = Math.max(0, Number(durationSeconds) || 0);
    const key = JSON.stringify([safeMethod, safeRoute, safeStatus]);
    let series = httpRequests.get(key);
    if (!series) {
      series = { method: safeMethod, route: safeRoute, status: safeStatus, count: 0, sum: 0, buckets: Array(HISTOGRAM_BUCKETS.length).fill(0) };
      httpRequests.set(key, series);
    }
    series.count += 1;
    series.sum += duration;
    HISTOGRAM_BUCKETS.forEach((bucket, index) => {
      if (duration <= bucket) series.buckets[index] += 1;
    });
  }

  function isAuthorized(authorizationHeader) {
    if (!token || typeof authorizationHeader !== 'string' || !authorizationHeader.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(authorizationHeader.slice(7), 'utf8');
    const expected = Buffer.from(token, 'utf8');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  function render({ socketCount = 0 } = {}) {
    const lines = [];
    const declare = (name, type, help) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
    };

    declare('tu_tien_http_requests_total', 'counter', 'Completed HTTP requests.');
    declare('tu_tien_http_request_duration_seconds', 'histogram', 'HTTP response duration in seconds.');
    for (const series of httpRequests.values()) {
      const labels = `method="${escapeLabel(series.method)}",route="${escapeLabel(series.route)}",status="${escapeLabel(series.status)}"`;
      lines.push(`tu_tien_http_requests_total{${labels}} ${series.count}`);
      HISTOGRAM_BUCKETS.forEach((bucket, index) => {
        lines.push(`tu_tien_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${series.buckets[index]}`);
      });
      lines.push(`tu_tien_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${series.count}`);
      lines.push(`tu_tien_http_request_duration_seconds_sum{${labels}} ${numberValue(series.sum)}`);
      lines.push(`tu_tien_http_request_duration_seconds_count{${labels}} ${series.count}`);
    }

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const lagMax = eventLoopDelay.max / 1e9;
    const lagP99 = eventLoopDelay.percentile(99) / 1e9;
    const safeSocketCount = Number.isFinite(socketCount) ? Math.max(0, socketCount) : 0;
    declare('process_uptime_seconds', 'gauge', 'Process uptime in seconds.');
    lines.push(`process_uptime_seconds ${numberValue(process.uptime())}`);
    declare('process_resident_memory_bytes', 'gauge', 'Resident memory size in bytes.');
    lines.push(`process_resident_memory_bytes ${memory.rss}`);
    declare('nodejs_heap_size_used_bytes', 'gauge', 'V8 heap size used in bytes.');
    lines.push(`nodejs_heap_size_used_bytes ${memory.heapUsed}`);
    declare('nodejs_heap_size_total_bytes', 'gauge', 'V8 heap size allocated in bytes.');
    lines.push(`nodejs_heap_size_total_bytes ${memory.heapTotal}`);
    declare('process_cpu_user_seconds_total', 'counter', 'Total user CPU time in seconds.');
    lines.push(`process_cpu_user_seconds_total ${numberValue(cpu.user / 1e6)}`);
    declare('process_cpu_system_seconds_total', 'counter', 'Total system CPU time in seconds.');
    lines.push(`process_cpu_system_seconds_total ${numberValue(cpu.system / 1e6)}`);
    declare('nodejs_eventloop_lag_seconds', 'gauge', 'Maximum event loop delay since the previous scrape.');
    lines.push(`nodejs_eventloop_lag_seconds ${numberValue(lagMax)}`);
    declare('nodejs_eventloop_lag_p99_seconds', 'gauge', '99th percentile event loop delay since the previous scrape.');
    lines.push(`nodejs_eventloop_lag_p99_seconds ${numberValue(lagP99)}`);
    declare('tu_tien_socketio_connected_clients', 'gauge', 'Current Socket.IO transport connections.');
    lines.push(`tu_tien_socketio_connected_clients ${numberValue(safeSocketCount)}`);
    eventLoopDelay.reset();
    return `${lines.join('\n')}\n`;
  }

  return { start, close, observeRequest, isAuthorized, render };
}

module.exports = { createPrometheusMetrics };
