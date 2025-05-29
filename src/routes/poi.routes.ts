import express from 'express';
import multer from 'multer';
import { Request, Response } from 'express';
import POIService from '../services/poi.service';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB total limit
  },
  fileFilter: (req, file, cb) => {
    // Accept all file types as per documentation
    cb(null, true);
  },
});

// Middleware to validate Bearer token authentication
const validateBearerToken = (req: Request, res: Response, next: any) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(
      POIService.createErrorResponse('Unauthorized: Invalid or missing API token', 401)
    );
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  
  // Validate the token (you should replace this with your actual token validation logic)
  const validApiKey = process.env.POI_API_KEY || 'your-api-key-here';
  
  if (token !== validApiKey) {
    return res.status(401).json(
      POIService.createErrorResponse('Unauthorized: Invalid or missing API token', 401)
    );
  }

  next();
};

/**
 * POST /api/v1/inventions
 * Generate Proof of Invention
 */
router.post('/inventions', validateBearerToken, upload.array('files'), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    // Validate files using the service
    const validation = POIService.validateFiles(files);
    if (!validation.valid) {
      return res.status(400).json(
        POIService.createErrorResponse(validation.error!, 400)
      );
    }

    // Generate proof of invention
    const result = await POIService.generateProofOfInvention(files);

    // Return successful response
    return res.json(POIService.createSuccessResponse(result));

  } catch (error) {
    console.error('Error generating proof of invention:', error);
    
    return res.status(500).json(
      POIService.createErrorResponse('Internal server error occurred while processing your request', 500)
    );
  }
});

// Error handling middleware for multer
router.use((error: any, req: Request, res: Response, next: any) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json(
        POIService.createErrorResponse('File size exceeds the 100MB limit', 400)
      );
    }
    
    return res.status(400).json(
      POIService.createErrorResponse('File upload error: ' + error.message, 400)
    );
  }
  
  next(error);
});

export default router; 