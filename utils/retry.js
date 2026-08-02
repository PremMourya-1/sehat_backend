// Minimal retry helper for transient failures (timeouts, upstream 5xx).
// Pass a `shouldRetry(error)` predicate so callers don't retry things that
// will just fail the same way again (validation errors, bad payloads).
async function retryAsync(fn, { attempts = 2, delayMs = 1000, shouldRetry = () => true } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === attempts || !shouldRetry(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

module.exports = { retryAsync };
