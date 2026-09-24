export const POT_PER_ENTRY = 1.25;
export const TICKET_PRICE = 2.5;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const londonFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function londonParts(date) {
  const bag = {};
  for (const part of londonFormatter.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return bag;
}

export function londonToUtc(year, month, day, hour, minute) {
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const desired = utc;
  for (let i = 0; i < 4; i += 1) {
    const parts = londonParts(new Date(utc));
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const delta = desired - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

export function nextDrawDate(now = new Date()) {
  const parts = londonParts(now);
  let year = Number(parts.year);
  let month = Number(parts.month);
  const thisMonth = londonToUtc(year, month, 1, 20, 0);
  if (now.getTime() >= thisMonth.getTime()) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return londonToUtc(year, month, 1, 20, 0);
}

export function formatUkDate(value, { withTime = false } = {}) {
  if (!value) return "None";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "None";
  const parts = londonParts(date);
  const label = `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`;
  if (!withTime) return label;
  return `${label}, ${parts.hour}:${parts.minute} UK time`;
}

export function formatGbp(amount) {
  const number = Number(amount);
  if (!Number.isFinite(number)) return "Unavailable";
  return `£${number.toFixed(2)}`;
}

export function potFor(activeCount) {
  return Math.round(activeCount * POT_PER_ENTRY * 100) / 100;
}
