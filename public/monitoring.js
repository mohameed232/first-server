// Shared polling and validation logic; embedded before app.js in index.html.
((global) => {
  "use strict";
  const POLL_MS = 5000;
  const TIMEOUT_MS = 4000;

  function validateMetrics(value, now = Date.now()) {
    const percent = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
    const capacity = (v) => v && percent(v.percent)
      && Number.isSafeInteger(v.total_bytes) && v.total_bytes > 0
      && Number.isSafeInteger(v.used_bytes) && v.used_bytes >= 0 && v.used_bytes <= v.total_bytes
      && Math.abs(v.percent - 100 * v.used_bytes / v.total_bytes) <= 0.11;
    if (!value || !percent(value.cpu_percent) || !capacity(value.memory) || !capacity(value.disk)
      || typeof value.uptime_seconds !== "number" || !Number.isFinite(value.uptime_seconds)
      || value.uptime_seconds < 0 || typeof value.timestamp !== "string") {
      throw new Error("Invalid metrics");
    }
    const timestamp = Date.parse(value.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 60000) {
      throw new Error("Stale or invalid server timestamp");
    }
    return value;
  }

  function createMonitor({ onData, onState, fetchImpl = global.fetch.bind(global),
    visibility = global.document, schedule = global.setTimeout.bind(global),
    cancel = global.clearTimeout.bind(global), now = () => Date.now() }) {
    let running = false;
    let generation = 0;
    let nextPoll;
    let active;

    function suspend() {
      generation += 1;
      cancel(nextPoll);
      if (active) {
        active.controller.abort();
        active.reject(new Error("Suspended"));
      }
      active = null;
    }

    async function poll() {
      if (!running || visibility.hidden || active) return;
      const current = generation;
      const controller = new AbortController();
      let deadline;
      const interrupted = new Promise((_, reject) => {
        active = { controller, reject };
        deadline = schedule(() => {
          controller.abort();
          reject(new Error("Metrics request timed out"));
        }, TIMEOUT_MS);
      });
      try {
        const request = (async () => {
          const response = await fetchImpl("/api/metrics", {
            signal: controller.signal, cache: "no-store", headers: { Accept: "application/json" },
          });
          if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
            throw new Error("Metrics endpoint unavailable");
          }
          return validateMetrics(await response.json(), now());
        })();
        const metrics = await Promise.race([request, interrupted]);
        if (running && current === generation && !visibility.hidden) {
          onData(metrics);
          onState("live");
        }
      } catch (_) {
        if (running && current === generation && !visibility.hidden) onState("offline");
      } finally {
        cancel(deadline);
        if (current === generation) {
          active = null;
          if (running && !visibility.hidden) nextPoll = schedule(poll, POLL_MS);
        }
      }
    }

    function visibilityChanged() {
      suspend();
      onState("offline");
      if (!visibility.hidden) poll();
    }

    return {
      start() {
        if (running) return;
        running = true;
        onState("offline");
        visibility.addEventListener("visibilitychange", visibilityChanged);
        poll();
      },
      stop() {
        running = false;
        suspend();
        visibility.removeEventListener("visibilitychange", visibilityChanged);
      },
    };
  }

  const api = { validateMetrics, createMonitor, POLL_MS, TIMEOUT_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.NexusMonitoring = api;
})(globalThis);
