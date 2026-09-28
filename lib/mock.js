export const MOCK_PLAN = {
  id: "mock-lottery-plan",
  name: "Sample Lottery Plan",
  matchedBy: "sample data",
};

export const MOCK_MEMBERS = [
  {
    memberId: "mock-ada",
    name: "Sample Member Ada",
    email: "ada.sample@example.com",
    status: "Active",
    active: true,
    startDate: "2026-01-05T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-ben",
    name: "Sample Member Ben",
    email: "ben.sample@example.com",
    status: "Active",
    active: true,
    startDate: "2026-02-11T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-cleo",
    name: "Sample Member Cleo",
    email: "cleo.sample@example.com",
    status: "Active",
    active: true,
    startDate: "2026-03-02T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-drew",
    name: "Sample Member Drew",
    email: "drew.sample@example.com",
    status: "Active",
    active: true,
    startDate: "2026-04-18T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-erin",
    name: "Sample Member Erin",
    email: "erin.sample@example.com",
    status: "Cancelled",
    active: false,
    startDate: "2025-11-01T10:00:00.000Z",
    endDate: "2026-05-20T10:00:00.000Z",
  },
  {
    memberId: "mock-fran",
    name: "Sample Member Fran",
    email: "fran.sample@example.com",
    status: "Ended",
    active: false,
    startDate: "2025-06-01T10:00:00.000Z",
    endDate: "2026-06-01T10:00:00.000Z",
  },
];

export const MOCK_KNOWN_NAMES = {
  "mock-sam": "Sample Winner Sam",
  ...Object.fromEntries(MOCK_MEMBERS.map((member) => [member.memberId, member.name])),
};

export const MOCK_KNOWN_EMAILS = {
  "mock-sam": "sam.sample@example.com",
  ...Object.fromEntries(MOCK_MEMBERS.map((member) => [member.memberId, member.email])),
};

export const MOCK_SEED_DRAWS = [
  {
    memberId: "mock-sam",
    initials: "S.S.",
    drawnAt: "2026-08-01T19:00:00.000Z",
    entryCount: 4,
    potAmount: 5,
  },
];

export function isMockMode() {
  const flag = String(process.env.WIX_MOCK || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}
