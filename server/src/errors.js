export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code);
export const forbidden = (msg, code) => new HttpError(403, msg, code);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);
