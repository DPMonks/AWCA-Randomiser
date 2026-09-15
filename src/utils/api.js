export async function drawWinner() {
  const res = await fetch('/_functions/randomiser');
  return res.json();
}
