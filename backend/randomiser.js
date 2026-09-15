/**
 * AWCA Lottery - /randomiser endpoint
 * Returns a random winner from active subscribers.
 *
 * Placeholder: replace in-memory list with your real data store.
 */

const mockSubscribers = [
  { name: "Test User 1", email: "test1@example.com" },
  { name: "Test User 2", email: "test2@example.com" }
];

export async function randomiser() {
  if (!mockSubscribers.length) {
    return new Response(
      JSON.stringify({ winner: null, message: "No subscribers available." }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const idx = Math.floor(Math.random() * mockSubscribers.length);
  const winner = mockSubscribers[idx];

  return new Response(
    JSON.stringify({ winner }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
