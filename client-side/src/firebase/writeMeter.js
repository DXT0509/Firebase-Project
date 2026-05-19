let _totalWrites = 0;
let _lastTotal = 0;
let _logger = null;

export const incrementDbWrites = (n = 1) => {
  _totalWrites += Number(n) || 0;
};

export const getTotalWrites = () => _totalWrites;

export const startWriteLogging = (intervalMs = 1000) => {
  if (typeof window === 'undefined') return; // only in browser
  if (_logger) return;
  try {
    // quick visible marker so developer knows logger started
    // eslint-disable-next-line no-console
    console.log('[writeMeter] startWriteLogging()', { intervalMs });
  } catch (e) {}
  _logger = setInterval(() => {
    const delta = _totalWrites - _lastTotal;
    _lastTotal = _totalWrites;
    try {
      // eslint-disable-next-line no-console
      console.log(`Writes/sec: ${delta}`);
    } catch (e) {}
  }, intervalMs);
  // expose for quick runtime inspection
  try {
    // eslint-disable-next-line no-undef
    window.__writeMeter = window.__writeMeter || {};
    window.__writeMeter.getTotalWrites = getTotalWrites;
  } catch (e) {}
};

/**
 * Start sampling Writes/sec and when `targetSamples` positive samples
 * have been collected, trigger a CSV download in the browser.
 * Options: { intervalMs=1000, targetSamples=60, minValue=1, filename='writes.csv' }
 */
export const startWriteSamplingCsv = (opts = {}) => {
  const { intervalMs = 1000, targetSamples = 60, minValue = 1, filename = 'writes.csv' } = opts;
  if (typeof window === 'undefined') return Promise.reject(new Error('browser-only'));
  // keep independent of main logger
  let last = _totalWrites;
  const samples = [];
  return new Promise((resolve) => {
    const t = setInterval(() => {
      const cur = _totalWrites;
      const delta = cur - last;
      last = cur;
      const now = new Date().toISOString();
      if (delta > minValue - 1) {
        samples.push({ ts: now, value: delta });
      }
      // also log to console for visibility
      try { console.log(`Writes/sec: ${delta}`); } catch (e) {}
      if (samples.length >= targetSamples) {
        clearInterval(t);
        // build CSV
        const rows = ['timestamp,writes_per_sec', ...samples.map(s => `${s.ts},${s.value}`)];
        const csv = rows.join('\n');
        // Prefer to POST CSV to local save server if available, otherwise trigger download
        const tryPostToLocal = async () => {
          try {
            const resp = await fetch('http://localhost:3001/save-csv', {
              method: 'POST',
              headers: { 'Content-Type': 'text/csv', 'X-Filename': filename },
              body: csv,
            });
            if (!resp.ok) throw new Error('non-OK');
            const j = await resp.json().catch(() => ({}));
            // eslint-disable-next-line no-console
            console.log('[writeMeter] posted CSV to local server', j);
            return true;
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[writeMeter] could not POST to local server, will fallback to download', e);
            return false;
          }
        };

        try {
          // store on window for manual access regardless
          window.__writeMeter = window.__writeMeter || {};
          window.__writeMeter._lastCsv = csv;
          window.__writeMeter._lastSamples = samples.slice();
        } catch (e) {}

        (async () => {
          const posted = await tryPostToLocal();
          if (!posted) {
            try {
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              a.remove();
              URL.revokeObjectURL(url);
              // eslint-disable-next-line no-console
              console.log('[writeMeter] triggered download fallback');
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn('[writeMeter] download fallback failed; CSV available at window.__writeMeter._lastCsv');
            }
          }
        })();
        resolve(samples);
      }
    }, intervalMs);
    // expose stop handle
    try {
      window.__writeMeter = window.__writeMeter || {};
      window.__writeMeter._samplingStop = () => clearInterval(t);
    } catch (e) {}
  });
};

try {
  if (typeof window !== 'undefined') {
    window.__writeMeter = window.__writeMeter || {};
    window.__writeMeter.startSamplingCsv = startWriteSamplingCsv;
  }
} catch (e) {}

export const stopWriteLogging = () => {
  if (_logger) {
    clearInterval(_logger);
    _logger = null;
  }
};

export default {
  incrementDbWrites,
  getTotalWrites,
  startWriteLogging,
  stopWriteLogging,
};
