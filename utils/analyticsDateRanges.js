// Date-range helpers for the admin analytics dashboard
// (controllers/adminAnalyticsController.js). All "today/week/month" boundaries
// are computed in IST, not server-local/UTC time — Render's server clock is
// UTC, but "today" for an India-only business must mean the IST calendar
// day, or late-evening IST orders would get counted as "tomorrow".
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function startOfTodayIST(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

// Monday-start business week.
function startOfWeekIST(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const day = shifted.getUTCDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  shifted.setUTCDate(shifted.getUTCDate() - diff);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

function startOfMonthIST(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  shifted.setUTCDate(1);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

function daysAgoIST(days, now = new Date()) {
  const start = startOfTodayIST(now);
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}

// Parses `?range=today|week|month|custom&from=&to=` into a concrete
// { start, end } instant pair. `end` is always "now" except for a custom
// range, where `to` is treated as end-of-day IST (inclusive).
function resolveRange(query) {
  const { range, from, to } = query;
  const now = new Date();

  if (range === "custom" && from) {
    const start = new Date(from);
    let end = to ? new Date(to) : now;
    if (to) {
      // Treat a bare `to` date as inclusive of that whole IST day.
      const shifted = new Date(end.getTime() + IST_OFFSET_MS);
      shifted.setUTCHours(23, 59, 59, 999);
      end = new Date(shifted.getTime() - IST_OFFSET_MS);
    }
    return { start, end, label: "custom" };
  }

  if (range === "week") return { start: startOfWeekIST(now), end: now, label: "week" };
  if (range === "month") return { start: startOfMonthIST(now), end: now, label: "month" };
  return { start: startOfTodayIST(now), end: now, label: "today" };
}

module.exports = {
  IST_OFFSET_MS,
  startOfTodayIST,
  startOfWeekIST,
  startOfMonthIST,
  daysAgoIST,
  resolveRange,
};
