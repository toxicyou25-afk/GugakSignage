/* SPDX-License-Identifier: Apache-2.0 */
/**
 * A single-flight, generation-aware cache readiness coordinator. Kept free of
 * DOM and IndexedDB dependencies so request races can be regression-tested.
 */
export function restoreHostManagedMode(runtime, cached) {
  return runtime.hostManaged || (
    !runtime.token
    && Boolean(runtime.deviceId && cached?.manifest?.device?.id === runtime.deviceId)
  );
}

export function createCacheReadiness() {
  let generation = 0;
  const flights = new Map();
  let ready = false;

  return {
    get ready() { return ready; },
    begin() {
      generation += 1;
      ready = false;
      for (const [token, operation] of flights) {
        if (token < generation) flights.delete(token);
        void operation.catch(() => {});
      }
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    async prepare(token, prepareAssets) {
      if (token !== generation) return false;
      if (flights.has(token)) return flights.get(token);
      const operation = Promise.resolve()
        .then(() => prepareAssets(() => token === generation))
        .then(Boolean, () => false);
      flights.set(token, operation);
      const result = await operation;
      if (flights.get(token) === operation) flights.delete(token);
      if (token !== generation) return false;
      ready = result;
      return ready;
    },
    invalidate() {
      generation += 1;
      ready = false;
      for (const [token, operation] of flights) {
        if (token < generation) flights.delete(token);
        void operation.catch(() => {});
      }
    },
  };
}
