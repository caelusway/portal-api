import { Request, Response, NextFunction } from 'express';
import config from '../config';

/**
 * Middleware to validate API key for protected routes
 * Checks for 'x-api-key' header in the request
 */
export const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  // Get API key from request headers
  const apiKey = req.headers['x-api-key'] as string;
  
  // Check if API key is provided and matches the configured key
  if (!apiKey || apiKey !== config.security.apiKey) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: Invalid or missing API key'
    });
  }
  
  // If API key is valid, proceed to the next middleware or route handler
  next();
}; 