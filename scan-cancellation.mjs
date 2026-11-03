export function scanCancelled(signal) {
  if (signal?.aborted) throw Object.assign(Error('SCAN_CANCELLED'), { statusCode: 409 });
}
export function awaitScan(promise, signal) {
  scanCancelled(signal);
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const cancelled = () => {
      signal.removeEventListener('abort', cancelled);
      reject(Object.assign(Error('SCAN_CANCELLED'), { statusCode: 409 }));
    };
    signal.addEventListener('abort', cancelled, { once: true });
    Promise.resolve(promise).then(
      value => { signal.removeEventListener('abort', cancelled); resolve(value); },
      error => { signal.removeEventListener('abort', cancelled); reject(error); },
    );
  });
}
