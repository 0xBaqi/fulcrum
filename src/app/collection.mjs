// Wait for actual local time; never shift the clock or grant a freshness grace period.

function sourceTimes(value, out = []) {
  if (value === null || value === undefined) return out;

  if (Array.isArray(value)) {
    for (const item of value) sourceTimes(item, out);
    return out;
  }

  if (typeof value !== 'object') return out;

  if (
    Number.isSafeInteger(value.sourceTimestamp) &&
    value.sourceTimestamp > 0
  ) {
    out.push(value.sourceTimestamp);
  }

  const responseDate = Date.parse(value.responseHeaders?.date);
  if (Number.isFinite(responseDate)) {
    out.push(responseDate);
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'sourceTimestamp' || key === 'responseHeaders') continue;
    sourceTimes(child, out);
  }

  return out;
}

export function settledCollector(
  collect,
  {
    clock = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    maxWaitMs = 3000,
    onTiming = () => {}
  } = {}
) {
  return async options => {
    const snapshot = await collect(options);

    const times = sourceTimes(snapshot);

const settleableTimes = times.filter(timestamp => {
  const lead = timestamp - snapshot.asOfMs;
  return lead > 0 && lead <= maxWaitMs;
});

if (settleableTimes.length === 0) return snapshot;

const latest = Math.max(...settleableTimes);

    const waitStartedAt = clock();
    const delay = Math.max(0, latest - waitStartedAt) + 1;

    if (delay > maxWaitMs + 1) return snapshot;

    await sleep(delay);

    const evaluatedAt = clock();

    onTiming({
      originalAsOfMs: snapshot.asOfMs,
      providerDateMs: latest,
      waitStartedAt,
      evaluatedAt,
      reasonCode: 'WAITED_FOR_SOURCE_TIMESTAMP'
    });

    return {
      ...snapshot,
      asOfMs: Math.max(snapshot.asOfMs, evaluatedAt)
    };
  };
}
