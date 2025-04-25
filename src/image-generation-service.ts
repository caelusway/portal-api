import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Generates a unique filename for an image
 */
function generateUniqueFilename(): string {
  return `${crypto.randomUUID()}.png`;
}

/**
 * Ensures the images directory exists
 */
function ensureImageDirectory(): string {
  const imageDir = path.join(process.cwd(), 'public', 'images');
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }
  return imageDir;
}

/**
 * Generates an image for an Idea NFT based on project description
 * @param projectId - The ID of the project
 * @param description - Project description to use as prompt basis
 * @returns The URL path to the generated image
 */
export async function generateIdeaNFTImage(
  projectId: string,
  description: string
): Promise<string> {
  try {
    console.log(`Generating Idea NFT image for project ${projectId}`);

    // Create a prompt that will generate a suitable scientific/idea visualization
    const prompt = `Create a unique, abstract visualization of a scientific idea or hypothesis based on this description: "${description}". 
    The image should look like a modern, minimalist science concept art with light blue and white colors. It should convey innovation and scientific discovery.`;

    let response;
    try {
      response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
    } catch (primaryError) {
      console.warn('gpt-image-1 failed, falling back to dall-e-3:', primaryError);
      response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
    }

    // Get image URL from response
    const imageUrl = response.data[0].url;
    if (!imageUrl) {
      throw new Error('Failed to generate image: No URL returned');
    }

    // Download and save the image
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const imageDir = ensureImageDirectory();
    const filename = generateUniqueFilename();
    const imagePath = path.join(imageDir, filename);

    fs.writeFileSync(imagePath, buffer);

    // Return the relative path that can be used in URLs
    const relativePath = `/images/${filename}`;

    // Update the NFT record in the database - this step is removed as it's now handled
    // during NFT creation in the handleNftMinting function
    console.log(`Idea NFT image generated successfully at ${relativePath}`);
    return relativePath;
  } catch (error) {
    console.error('Error generating Idea NFT image:', error);
    throw error;
  }
}

/**
 * Generates an image for a Hypothesis/Vision NFT based on project vision
 * @param projectId - The ID of the project
 * @param vision - Project vision to use as prompt basis
 * @returns The URL path to the generated image
 */
export async function generateVisionNFTImage(projectId: string, vision: string): Promise<string> {
  try {
    console.log(`Generating Vision NFT image for project ${projectId}`);

    // Create a prompt that will generate a suitable vision/future visualization
    const prompt = `Create a vibrant, futuristic visualization representing this vision: "${vision}". 
    The image should look like a forward-looking concept art with purple and gold accents. It should convey the future potential and impact of this scientific vision.`;

    let response;
    try {
      response = await openai.images.generate({
        model: 'gpt-image-1',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
    } catch (primaryError) {
      console.warn('gpt-image-1 failed, falling back to dall-e-3:', primaryError);
      response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });
    }

    // Get image URL from response
    const imageUrl = response.data[0].url;
    if (!imageUrl) {
      throw new Error('Failed to generate image: No URL returned');
    }

    // Download and save the image
    const imageResponse = await fetch(imageUrl);
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const imageDir = ensureImageDirectory();
    const filename = generateUniqueFilename();
    const imagePath = path.join(imageDir, filename);

    fs.writeFileSync(imagePath, buffer);

    // Return the relative path that can be used in URLs
    const relativePath = `/images/${filename}`;

    // Update the NFT record in the database - this step is removed as it's now handled
    // during NFT creation in the handleNftMinting function
    console.log(`Vision NFT image generated successfully at ${relativePath}`);
    return relativePath;
  } catch (error) {
    console.error('Error generating Vision NFT image:', error);
    throw error;
  }
}
