import { PydanticError } from "./types"

export class ValidationError extends Error {
  errors: PydanticError[]

  constructor (msg: string, errors: PydanticError[]) {
    super(msg)
    this.name = 'ValidationError'
    this.errors = errors
  }
}

export function isValidationError (error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

export function parseSocketError (error: Error | ValidationError): Record<string, string[]> {
  if (!isValidationError(error)) return { __root__: [error.message] }
  const locErrors: Record<string, string[]> = {}
  for (const e of error.errors) {
    const loc = e.loc[0] // Assumes non-empty list
    if (!(loc in locErrors)) locErrors[loc] = []
    locErrors[loc].push(e.msg)
  }
  return locErrors
}
