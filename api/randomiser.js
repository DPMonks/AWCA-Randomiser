import { randomiser } from "../backend/randomiser.js";
export default async function handler(req, res) {
  const response = await randomiser(req);
  res.status(response.status).setHeader("Content-Type", "application/json");
  res.end(await response.text());
}
