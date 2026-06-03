/**
 * Airtable Error Handling and Retry Logic
 * 
 * Distinguishes between:
 * - Transient errors (retryable): 429, 503, 504, network timeouts
 * - Permanent errors (non-retryable): 400, 401, 403, 404, validation errors
 */

export interface AirtableError {
  error: {
    type: string;
    message: string;
  };
  status?: number;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * Determine if an error is transient (retryable)
 */
export function isTransientError(error: unknown): boolean {
  // Network errors
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("econnrefused") ||
      message.includes("enotfound") ||
      message.includes("timeout") ||
      message.includes("connection")
    ) {
      return true;
    }
  }

  // HTTP status codes
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as Record<string, unknown>).status;
    if (typeof status === "number") {
      // 429 = Too Many Requests, 5xx = Server Error
      return status === 429 || (status >= 500 && status < 600);
    }
  }

  return false;
}

/**
 * Extract error message from Airtable response
 */
export function getAirtableErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const err = error as Record<string, unknown>;

    // Airtable error format
    if (
      err.error &&
      typeof err.error === "object" &&
      "message" in (err.error as Record<string, unknown>)
    ) {
      return ((err.error as Record<string, unknown>).message as string) || "Unknown error";
    }

    // Standard error message
    if (err.message && typeof err.message === "string") {
      return err.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = defaultRetryConfig
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if error is permanent
      if (!isTransientError(error)) {
        throw error;
      }

      // Don't sleep after final attempt
      if (attempt < config.maxRetries) {
        const delayMs = Math.min(
          config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError;
}

/**
 * Transform task to Airtable record
 */
export interface AirtableRecord {
  fields: {
    Title: string;
    Status: string;
    Description?: string;
    Assignee?: string;
    "Created By"?: string;
    "Created At": string;
    "Updated At": string;
    Position?: number;
    "Taskboard ID": string;
  };
}

/**
 * Format date for Airtable (ISO format)
 */
export function formatDateForAirtable(date: Date): string {
  return date.toISOString().split("T")[0]; // YYYY-MM-DD
}
