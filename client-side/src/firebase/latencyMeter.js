let _logger = null;
let _pendingSamples = [];
let _lastSeqBySender = new Map();
let _lastSampleAt = 0;

const summarizeSamples = (samples) => {
  if (!samples.length) return null;
  const total = samples.reduce((sum, value) => sum + value, 0);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = total / samples.length;
  const last = samples[samples.length - 1];
  return { avg, min, max, last, count: samples.length };
};

export const recordMoveLatency = ({ senderId, moveSeq, moveSentAt }) => {
  if (typeof window === 'undefined') return false;
  if (!senderId || !Number.isFinite(moveSeq) || moveSeq <= 0) return false;
  if (!Number.isFinite(moveSentAt) || moveSentAt <= 0) return false;

  const lastSeq = _lastSeqBySender.get(senderId) || 0;
  if (moveSeq <= lastSeq) return false;
  _lastSeqBySender.set(senderId, moveSeq);

  const latencyMs = Date.now() - moveSentAt;
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return false;

  _pendingSamples.push(latencyMs);
  _lastSampleAt = Date.now();
  try {
    window.__latencyMeter = window.__latencyMeter || {};
    window.__latencyMeter._lastLatencyMs = latencyMs;
    window.__latencyMeter._lastSenderId = senderId;
    window.__latencyMeter._lastMoveSeq = moveSeq;
  } catch (e) {}
  return true;
};

export const startLatencyLogging = (intervalMs = 1000) => {
  if (typeof window === 'undefined') return;
  if (_logger) return;

  try {
    // eslint-disable-next-line no-console
    console.log('[latencyMeter] startLatencyLogging()', { intervalMs });
  } catch (e) {}

  _logger = setInterval(() => {
    const samples = _pendingSamples;
    _pendingSamples = [];
    const summary = summarizeSamples(samples);

    try {
      window.__latencyMeter = window.__latencyMeter || {};
      window.__latencyMeter._lastSummary = summary;
      window.__latencyMeter.getLastSummary = () => summary;
      window.__latencyMeter._lastSampleAt = _lastSampleAt;
    } catch (e) {}

    try {
      if (!summary) {
        const idleForMs = _lastSampleAt ? Date.now() - _lastSampleAt : null;
        // eslint-disable-next-line no-console
        console.log(
          '[latencyMeter] move latency: waiting for a remote player update',
          idleForMs === null ? '' : `(last sample ${idleForMs}ms ago)`,
        );
        return;
      }

      // eslint-disable-next-line no-console
      console.log(
        `[latencyMeter] move latency: avg=${summary.avg.toFixed(1)}ms last=${summary.last.toFixed(1)}ms min=${summary.min.toFixed(1)}ms max=${summary.max.toFixed(1)}ms samples=${summary.count}`,
      );
    } catch (e) {}
  }, intervalMs);

  try {
    window.__latencyMeter = window.__latencyMeter || {};
    window.__latencyMeter.stop = stopLatencyLogging;
  } catch (e) {}
};

export const stopLatencyLogging = () => {
  if (_logger) {
    clearInterval(_logger);
    _logger = null;
  }
};

export default {
  recordMoveLatency,
  startLatencyLogging,
  stopLatencyLogging,
};