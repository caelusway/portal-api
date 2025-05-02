import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Converts an image URL to a base64 string
 * @param imageUrl - URL of the image to convert
 * @returns Base64 encoded string of the image
 */
async function convertImageToBase64(imageUrl: string): Promise<string> {
  try {
    // Fetch the image
    const imageResponse = await fetch(imageUrl);
    // Convert to array buffer
    const arrayBuffer = await imageResponse.arrayBuffer();
    // Create a buffer
    const buffer = Buffer.from(arrayBuffer);
    // Convert to base64
    const base64String = buffer.toString('base64');
    // Return the base64 data URI
    return `data:image/png;base64,${base64String}`;
  } catch (error) {
    console.error('Error converting image to base64:', error);
    throw error;
  }
}

/**
 * Generates an image for an Idea NFT based on project description
 * @param projectId - The ID of the project
 * @param description - Project description to use as prompt basis
 * @returns The base64 encoded image data
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

    // Convert the image to base64
    const base64Image = await convertImageToBase64(imageUrl);
    console.log(`Idea NFT image generated successfully and converted to base64`);
    
    return base64Image;
  } catch (error) {
    console.error('Error generating Idea NFT image:', error);
    throw error;
  }
}

/**
 * Generates an image for a Hypothesis/Vision NFT based on project vision
 * @param projectId - The ID of the project
 * @param vision - Project vision to use as prompt basis
 * @returns The base64 encoded image data
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

    // Convert the image to base64
    const base64Image = await convertImageToBase64(imageUrl);
    console.log(`Vision NFT image generated successfully and converted to base64`);
    
    return base64Image;
  } catch (error) {
    console.error('Error generating Vision NFT image:', error);
    throw error;
  }
}
