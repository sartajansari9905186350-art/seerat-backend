import { Response } from 'express';

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  pagination?: {
    page: number;
    limit: number;
    total?: number;
    count?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export class ResponseUtil {
  static success<T>(
    res: Response,
    data: T,
    message?: string,
    statusCode: number = 200,
    pagination?: ApiResponse['pagination']
  ): Response {
    const payload: ApiResponse<T> = {
      success: true,
      ...(message ? { message } : {}),
      data,
      ...(pagination ? { pagination } : {})
    };
    return res.status(statusCode).json(payload);
  }

  static error(
    res: Response,
    code: string,
    message: string,
    statusCode: number = 400,
    details?: any
  ): Response {
    const payload: ApiResponse = {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {})
      }
    };
    return res.status(statusCode).json(payload);
  }
}
