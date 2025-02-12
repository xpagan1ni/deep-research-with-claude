import { z } from 'zod';
import { claudeModel } from './ai/providers';
import { systemPrompt } from './prompt';

export async function generateFeedback({
  query,
  numQuestions = 3,
}: {
  query: string;
  numQuestions?: number;
}) {
  const prompt = `Given the following query from the user, ask some follow up questions to clarify the research direction. Return a maximum of ${numQuestions} questions, but feel free to return less if the original query is clear: <query>${query}</query>`;

  const response = await claudeModel([
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: prompt }
  ]);

  try {
    const parsedResponse = JSON.parse(response);
    return parsedResponse.questions?.slice(0, numQuestions) || [];
  } catch (error) {
    console.error('Failed to parse Claude response:', error);
    return [];
  }
}
