/**
 * A custom error class for handling API-specific errors.
 * Allows for a status code to be associated with an error.
 */
export class ApiError extends Error {
  public readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, ApiError.prototype)
  }
}
