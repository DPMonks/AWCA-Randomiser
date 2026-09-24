export class LotteryError extends Error {
  constructor(message, status = 500, code = "ERROR") {
    super(message);
    this.name = "LotteryError";
    this.status = status;
    this.code = code;
  }
}
