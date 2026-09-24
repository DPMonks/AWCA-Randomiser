export const MOCK_PLAN = {
  id: "mock-lottery-plan",
  name: "Sample Lottery Plan",
  matchedBy: "sample data",
};

export const MOCK_MEMBERS = [
  {
    memberId: "mock-ada",
    name: "Sample Member Ada",
    status: "Active",
    active: true,
    startDate: "2026-01-05T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-ben",
    name: "Sample Member Ben",
    status: "Active",
    active: true,
    startDate: "2026-02-11T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-cleo",
    name: "Sample Member Cleo",
    status: "Active",
    active: true,
    startDate: "2026-03-02T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-drew",
    name: "Sample Member Drew",
    status: "Active",
    active: true,
    startDate: "2026-04-18T10:00:00.000Z",
    endDate: null,
  },
  {
    memberId: "mock-erin",
    name: "Sample Member Erin",
    status: "Cancelled",
    active: false,
    startDate: "2025-11-01T10:00:00.000Z",
    endDate: "2026-05-20T10:00:00.000Z",
  },
  {
    memberId: "mock-fran",
    name: "Sample Member Fran",
    status: "Ended",
    active: false,
    startDate: "2025-06-01T10:00:00.000Z",
    endDate: "2026-06-01T10:00:00.000Z",
  },
];

export const MOCK_SEED_DRAWS = [
  {
    winnerName: "Sample Winner Sam",
    winnerMemberId: "mock-sam",
    drawnAt: "2026-08-01T19:00:00.000Z",
    entryCount: 4,
    potAmount: 5,
  },
];

export function isMockMode() {
  const flag = String(process.env.WIX_MOCK || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}
