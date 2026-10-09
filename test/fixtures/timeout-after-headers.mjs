// Preloaded only by timeout integration tests. Keep real HTTP and wait until the
// loopback server has received the full write and deliberately stalled its body.
// Then abort that real response with Node's native timeout reason. No race with
// process/connection startup or a prerequisite billing summary request.
const transport = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const controller = new AbortController();
  const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
  const response = await transport(input, { ...init, signal });
  if (response.headers.get('x-gigstack-test-timeout') !== 'after-headers') return response;
  if (new URL(response.url).hostname !== '127.0.0.1') throw new Error('Timeout fixture must use loopback');
  const timeout = AbortSignal.timeout(0);
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true });
  // Native timeout signals are unref'd. Keep this subprocess alive until the
  // aborted response rejects; this timer does not control the timeout ordering.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await response.text();
    throw new Error('Timeout fixture unexpectedly completed its stalled body');
  } catch (error) {
    if (timeout.aborted) throw timeout.reason;
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
};
