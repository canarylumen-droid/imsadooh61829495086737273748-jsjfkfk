export interface ApiError {
  error: string;
  details?: string;
  tip?: string;
  code?: string;
}

export function sendError(res: any, status: number, error: string, details?: string, tip?: string, code?: string) {
  return res.status(status).json({
    error,
    ...(details ? { details } : {}),
    ...(tip ? { tip } : {}),
    ...(code ? { code } : {}),
  } as ApiError);
}
