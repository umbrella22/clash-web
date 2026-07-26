import { getPrecheckResult } from "../services/api";

/**
 * Single source of truth for turning an API/axios/Error value into a
 * user-facing message. Precheck detail wins, then the backend `error`
 * field, then the JS error message, then the caller's fallback.
 */
export function formatApiError(error: unknown, fallback: string): string {
  const precheck = getPrecheckResult(error);
  if (precheck?.error) return `${fallback}: ${precheck.error}`;

  if (typeof error === "object" && error && "response" in error) {
    const response = error.response as { data?: { error?: string } } | undefined;
    if (response?.data?.error) return response.data.error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
