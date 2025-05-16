import OpenAI from 'openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
// @ts-ignore
import pdfParse from 'pdf-parse';
import dotenv from 'dotenv';

// Load environment variables before initializing OpenAI
dotenv.config();

// Check if OpenAI API key exists
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn('WARNING: OPENAI_API_KEY environment variable is missing or empty');
  console.warn('PDF processing and embeddings generation will fail without a valid API key');
}

const openai = new OpenAI({
  apiKey: apiKey,
});

const EMBEDDING_MODEL = 'text-embedding-ada-002'; // Or your preferred OpenAI embedding model

/**
 * Parses a PDF from a buffer.
 * @param pdfBuffer Buffer containing the PDF data.
 * @returns The extracted text content of the PDF.
 */
async function parsePdf(pdfBuffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(pdfBuffer);
    return data.text;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw new Error('Failed to parse PDF content.');
  }
}

/**
 * Chunks text into smaller pieces suitable for embedding.
 * @param text The text to chunk.
 * @param chunkSize The maximum size of each chunk.
 * @param chunkOverlap The overlap between consecutive chunks.
 * @returns An array of text chunks.
 */
async function chunkText(text: string, chunkSize = 1000, chunkOverlap = 200): Promise<string[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });
  const documents = await splitter.createDocuments([text]);
  return documents.map(doc => doc.pageContent);
}

/**
 * Generates OpenAI embeddings for an array of text chunks.
 * @param chunks Array of text chunks.
 * @returns A promise that resolves to an array of embeddings.
 */
export async function generateEmbeddings(chunks: string[]): Promise<number[][]> {
  if (!chunks || chunks.length === 0) {
    return [];
  }
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunks.map(chunk => chunk.replace(/\n/g, ' ')), // OpenAI recommends replacing newlines
    });
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error generating OpenAI embeddings:', error);
    throw new Error('Failed to generate embeddings.');
  }
}

/**
 * Processes a PDF: parses, chunks, and generates embeddings for its content.
 * @param pdfBuffer Buffer containing the PDF data.
 * @param sourceIdentifier A string identifying the source of the PDF (e.g., filename).
 * @returns An array of objects, each containing a chunk, its embedding, and the source.
 */
export async function processPdfForIngestion(pdfBuffer: Buffer, sourceIdentifier: string): Promise<Array<{ chunk: string; embedding: number[]; source: string }>> {
  const text = await parsePdf(pdfBuffer);
  const chunks = await chunkText(text);
  const embeddings = await generateEmbeddings(chunks);

  if (chunks.length !== embeddings.length) {
    throw new Error('Mismatch between number of chunks and embeddings.');
  }

  return chunks.map((chunk, index) => ({
    chunk,
    embedding: embeddings[index],
    source: sourceIdentifier,
  }));
} 