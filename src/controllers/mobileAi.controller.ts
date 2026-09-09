import { NextFunction, Response } from 'express';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';
import { ResponseUtil } from '../utils/response';
import { logger } from '../utils/logger';

const systemPrompt = `You are the SEERAT Islamic information assistant, not an independent Mufti. Answer respectfully and concisely in the user's language where possible. Prefer Quran and authentic Hadith references when applicable, but never invent verses, Hadith, books, numbers, or citations. If a reference is uncertain, say it should be verified. Distinguish Quran, Hadith, scholarly explanation, and general information. State that scholarly opinions can differ on disputed fiqh matters. Do not issue binding fatwas; recommend a qualified Aalim or Mufti for complex or sensitive rulings. Do not generate non-Islamic promotional content.`;

export class MobileAiController {
  async assistant(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const language = typeof req.body?.language === 'string' ? req.body.language.trim().slice(0, 32) : 'en';

      if (!message || message.length > 2000) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Message must be between 1 and 2000 characters.', 400);
        return;
      }

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        logger.warn('AI Assistant unavailable: OPENROUTER_API_KEY is not configured on backend.');
        ResponseUtil.error(res, 'AI_UNAVAILABLE', 'The Islamic Assistant is temporarily unavailable. (Missing OPENROUTER_API_KEY on server)', 503);
        return;
      }

      const model = process.env.OPENROUTER_MODEL || 'openrouter/free';

      const provider = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://seerat.app',
          'X-Title': 'SEERAT Islamic Assistant'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Language preference: ${language}\n\nQuestion: ${message}` }
          ]
        })
      });

      if (!provider.ok) {
        const errorText = await provider.text();
        logger.error(`OpenRouter error (HTTP ${provider.status}): ${errorText.slice(0, 300)}`);
        let detailMsg = `HTTP ${provider.status}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed?.error?.message) {
            detailMsg = parsed.error.message;
          }
        } catch {}
        ResponseUtil.error(
          res,
          'AI_PROVIDER_ERROR',
          `The Islamic Assistant encountered a provider error: ${detailMsg}`,
          provider.status >= 500 ? 503 : 502
        );
        return;
      }

      const payload = await provider.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      const answer = payload.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        logger.warn('OpenRouter returned empty choices in payload');
        ResponseUtil.error(res, 'AI_EMPTY_RESPONSE', 'The Islamic Assistant could not generate a response. Please try again.', 502);
        return;
      }

      ResponseUtil.success(res, { answer, references: [], language }, 'Assistant response generated.');
    } catch (error) {
      logger.error('Unexpected error in mobileAi.assistant:', error);
      next(error);
    }
  }
}

export const mobileAiController = new MobileAiController();
