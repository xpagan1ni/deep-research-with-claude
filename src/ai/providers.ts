import { getEncoding } from 'js-tiktoken';
import { RecursiveCharacterTextSplitter } from './text-splitter';
import Anthropic from '@anthropic-ai/sdk';

// Providers
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY!,
});

function cleanJsonResponse(text: string): string {
  // Remove any markdown code blocks
  let cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
  
  // Remove any text before the first { and after the last }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Replace any control characters
  cleaned = cleaned.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

  // Normalize quotes
  cleaned = cleaned.replace(/[""]/g, '"');

  return cleaned;
}

// Models
export const claudeModel = async (
  messages: { role: string; content: string }[],
  options: { 
    temperature?: number;
    maxTokens?: number;
  } = {}
): Promise<string> => {
  try {
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';
    const userMessage = messages.find(m => m.role === 'user')?.content || '';
    
    // Add explicit JSON instruction to each message
    const enhancedSystemMessage = `${systemMessage}\n\nIMPORTANT: You must respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or other content outside the JSON structure. The response should start with '{' and end with '}'.`;
    const enhancedUserMessage = `${userMessage}\n\nRemember to respond with valid JSON only, starting with '{' and ending with '}'.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      messages: [
        { role: 'assistant', content: enhancedSystemMessage },
        { role: 'user', content: enhancedUserMessage }
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    });

    // Try to extract and clean JSON from the response
    const text = response.content[0]?.text.trim() || '';
    const jsonStr = cleanJsonResponse(text);
    
    try {
      // Validate JSON
      JSON.parse(jsonStr);
      return jsonStr;
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      console.error('Raw response:', text);
      console.error('Cleaned response:', jsonStr);
      throw parseError;
    }
  } catch (error: any) {
    if (error?.status === 429) {
      // Rate limit hit - wait and retry
      const retryAfter = Number(error.headers?.['retry-after'] || 60);
      console.log(`Rate limit hit. Waiting ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return claudeModel(messages, options);
    }
    throw error;
  }
};

const MinChunkSize = 140;
const encoder = getEncoding('o200k_base');

// trim prompt to maximum context size
export function trimPrompt(
  prompt: string,
  contextSize = Number(process.env.CONTEXT_SIZE) || 128_000,
) {
  if (!prompt) {
    return '';
  }

  const length = encoder.encode(prompt).length;
  if (length <= contextSize) {
    return prompt;
  }

  const overflowTokens = length - contextSize;
  // on average it's 3 characters per token, so multiply by 3 to get a rough estimate of the number of characters
  const chunkSize = prompt.length - overflowTokens * 3;
  if (chunkSize < MinChunkSize) {
    return prompt.slice(0, MinChunkSize);
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap: 0,
  });
  const trimmedPrompt = splitter.splitText(prompt)[0] ?? '';

  // last catch, there's a chance that the trimmed prompt is same length as the original prompt, due to how tokens are split & innerworkings of the splitter, handle this case by just doing a hard cut
  if (trimmedPrompt.length === prompt.length) {
    return trimPrompt(prompt.slice(0, chunkSize), contextSize);
  }

  // recursively trim until the prompt is within the context size
  return trimPrompt(trimmedPrompt, contextSize);
}
