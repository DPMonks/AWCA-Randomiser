import { lottery } from "../backend/lottery.js";
export default async function handler(req, res) {
  const response = await lottery(req);
  res.status(response.status).setHeader("Content-Type", "application/json");
  res.end(await response.text());
}
