// Coaching Agent's core logic
import OpenAI from 'openai';
import { generateEmbeddings } from './pdfHandler';
import { retrieveRelevantChunks, initializeDatabase } from './vectorStoreService';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env with explicit path to ensure it's found
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Check if OpenAI API key exists
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.warn('WARNING: OPENAI_API_KEY environment variable is missing or empty');
  console.warn('The coaching agent will not function without a valid API key');
}

// Initialize OpenAI client with error handling
let openai: OpenAI | null = null;
try {
  openai = new OpenAI({
    apiKey: apiKey,
  });
} catch (error) {
  console.error('Error initializing OpenAI client:', error);
}

// OpenAI model to use (you can update this to a newer model as needed)
const CHAT_MODEL = 'gpt-4-turbo'; // Use gpt-4-turbo for better reasoning or gpt-3.5-turbo for cost efficiency

// Database validation flag
let isDatabaseInitialized = false;

/**
 * Initialize the vector database if not already done
 */
async function ensureDatabaseInitialized(): Promise<boolean> {
  if (isDatabaseInitialized) {
    return true;
  }
  
  try {
    isDatabaseInitialized = await initializeDatabase();
    return isDatabaseInitialized;
  } catch (error) {
    console.error('Failed to initialize vector database:', error);
    return false;
  }
}

/**
 * Processes a user query, retrieves relevant context from PDFs, and generates a coaching response.
 * @param query The user's query.
 * @returns The coaching agent's response.
 */
export async function getCoachingResponse(query: string): Promise<string> {
  console.log(`Received coaching query: ${query}`);

  // Check for API key before proceeding
  if (!apiKey || !openai) {
    return "Sorry, I'm unable to process your request because the OpenAI API key is missing or invalid. Please contact the administrator to fix this issue.";
  }

  try {
    // 0. Ensure database is initialized
    const dbInitialized = await ensureDatabaseInitialized();
    if (!dbInitialized) {
      return "Sorry, I'm unable to process your request because the vector database is not properly initialized. Please contact the administrator to fix this issue.";
    }

    // 1. Generate embedding for the query
    console.log("Generating query embedding...");
    const queryEmbedding = (await generateEmbeddings([query]))[0];
    if (!queryEmbedding) {
      console.error('Failed to generate query embedding.');
      return "Sorry, I encountered an issue processing your request (embedding generation failed).";
    }

    // 2. Retrieve relevant chunks from vector store
    console.log("Retrieving relevant context from vector store...");
    const relevantChunks = await retrieveRelevantChunks(queryEmbedding, 5); // Get top 5 chunks for more context
    
    if (relevantChunks.length === 0) {
      console.warn("No relevant context found in the vector store for this query.");
      return "I don't have enough context in my knowledge base to answer this question confidently. Please try a different question related to the Guardian Framework or DAO governance.";
    }

    // Log the sources found for debugging
    const sources = new Set(relevantChunks.map(chunk => chunk.source));
    console.log(`Found relevant content from sources: ${Array.from(sources).join(', ')}`);

    // 3. Construct context for the LLM
    const context = relevantChunks
      .map((chunk, i) => `[Document ${i+1}] Source: ${chunk.source}\n${chunk.content}`)
      .join("\n\n---\n\n");

    // 4. Generate response using LLM with a coaching prompt
    console.log(`Sending request to OpenAI using ${CHAT_MODEL} model...`);
    const coachingPrompt = `You are a helpful AI coach. Your goal is to guide founders through implementing frameworks like the Guardian Framework, using the provided context from relevant documents.
Be clear, supportive, and actionable in your advice.

Context from documents:
---
${context}
---

User's question: ${query}

Your coaching response should be well-structured, concise, and to the point. If the context provided doesn't contain information relevant to the question, acknowledge this clearly.
    `;

    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: "system", content: "You are an AI coach specialized in guiding founders with business frameworks based on provided document excerpts." },
        { role: "user", content: coachingPrompt }
      ],
      temperature: 0.7,
      max_tokens: 1500, // Limit response length
    });
    
    const responseText = response.choices[0].message?.content?.trim() || "Sorry, I couldn't generate a response at this time.";
    console.log(`Generated response of length: ${responseText.length} characters`);
    
    return responseText;

  } catch (error) {
    console.error("Error in coaching agent:", error);
    
    // Provide more informative error responses based on error type
    if (error instanceof Error) {
      if (error.message.includes('429')) {
        return "Sorry, we're experiencing high demand at the moment. Please try again in a few moments.";
      } else if (error.message.includes('503')) {
        return "Sorry, the AI service is temporarily unavailable. Please try again later.";
      } else if (error.message.includes('database') || error.message.includes('vector')) {
        return "Sorry, there's an issue with our knowledge database. The team has been notified.";
      }
    }
    
    return "Sorry, I encountered an issue processing your request. Please try again later.";
  }
} 