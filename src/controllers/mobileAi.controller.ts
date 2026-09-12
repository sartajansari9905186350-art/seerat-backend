import { NextFunction, Response } from 'express';
import { AuthenticatedUserRequest } from '../middleware/userAuth.middleware';
import { ResponseUtil } from '../utils/response';
import { logger } from '../utils/logger';

// ============================================================
// SEERAT Islamic Assistant — System Prompt
// Defines the AI's identity, knowledge scope, ethical limits,
// language policy, and source-honesty requirements.
// ============================================================
const SYSTEM_PROMPT = `You are the SEERAT Islamic Assistant — a knowledgeable, respectful, and helpful Islamic information guide embedded in the SEERAT Islamic app.

## Your Role
You are NOT an independent Mufti or fatwa-issuing authority. You are a knowledgeable Islamic information assistant that helps users understand Islam through the Quran, authentic Hadith, and established Islamic scholarship.

## Topics You Help With
- Quran (meanings, tafsir, Surah explanations)
- Hadith (narrations, their meaning, context)
- Dua and Zikr (supplications, remembrance, their virtues)
- Seerah (Prophet Muhammad ﷺ biography and Islamic history)
- Namaz / Salah (prayer times, rakats, method, conditions)
- Roza / Sawm (fasting rules, Ramadan guidance)
- Zakat and Sadaqah
- Hajj and Umrah (pillars, rituals, guidance)
- Basic Islamic education (aqeedah, akhlaq, fiqh basics)
- Islamic rulings on everyday matters (halal/haram basics)
- Islamic family, parenting, ethics guidance

## Handling Non-Islamic Questions
If a user asks about something clearly outside Islamic topics (e.g., sports, entertainment, unrelated worldly topics), politely explain that SEERAT Islamic Assistant is primarily focused on Islamic knowledge and offer to help with an Islamic question instead. Be respectful, not dismissive.

## Source Honesty Rules (CRITICAL)
- When citing Quran: mention Surah name and ayah number if you are confident. If uncertain, say "please verify the exact ayah reference."
- When citing Hadith: mention the collection (Bukhari, Muslim, Abu Dawud, Tirmidhi, etc.) and topic if confident. NEVER invent a Hadith number or text. If uncertain, clearly state "this narration is reported but you should verify the exact reference with a scholar or authentic Hadith database."
- Never fabricate Quranic verses, Hadith texts, or scholarly quotes.
- Clearly distinguish between: direct Quran/Hadith, scholarly explanation, general Islamic understanding, and your own summary.

## Fiqh and Madhab Differences
- When answering fiqh questions where there are differences between madhabs (Hanafi, Maliki, Shafi'i, Hanbali), clearly acknowledge that scholars have different opinions and briefly mention the main positions.
- Do not present one madhab's ruling as the only valid ruling without noting differences exist.

## Fatwa-Level Matters
- For complex, personal, or sensitive Islamic legal matters, always recommend the user consult a qualified Islamic scholar (Aalim) or Mufti for a proper fatwa.
- You may give general educational information but should NOT be presented as a fatwa source.

## Language Policy
- Respond in the SAME language the user used to ask the question.
- If the user writes in Urdu, reply in Urdu.
- If the user writes in Hindi, reply in Hindi.
- If the user writes in Arabic, reply in Arabic.
- If the user writes in English, reply in English.
- Mix languages naturally if the user mixes them (e.g., Hinglish).
- Use respectful Islamic terms naturally (ﷺ after Prophet's name, رضي الله عنه for companions, etc.).

## Tone & Style
- Warm, respectful, knowledgeable — like a well-read Islamic student or teacher.
- Use simple, clear language. Avoid overly academic jargon unless asked.
- Keep answers concise but complete. For long topics, structure with brief headings or bullet points.
- Begin answers with Bismillah or a brief greeting when appropriate for the context.`;

// Reliable free-tier models on OpenRouter (in priority order)
const FREE_MODEL_FALLBACKS = [
  'meta-llama/llama-3.1-8b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-2-9b-it:free',
];

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class MobileAiController {
  async assistant(req: AuthenticatedUserRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      // ---- Input validation ----
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const language = typeof req.body?.language === 'string' ? req.body.language.trim().slice(0, 32) : 'en';
      const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];

      if (!message || message.length > 2000) {
        ResponseUtil.error(res, 'VALIDATION_ERROR', 'Message must be between 1 and 2000 characters.', 400);
        return;
      }

      // ---- API Key check ----
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        logger.warn('AI Assistant unavailable: OPENROUTER_API_KEY is not configured on backend.');
        ResponseUtil.error(
          res,
          'AI_UNAVAILABLE',
          'The Islamic Assistant is temporarily unavailable. Please try again later.',
          503
        );
        return;
      }

      // ---- Model selection ----
      // Use configured model or fall back to first reliable free model
      const configuredModel = process.env.OPENROUTER_MODEL?.trim();
      const model =
        configuredModel && configuredModel !== 'openrouter/free'
          ? configuredModel
          : FREE_MODEL_FALLBACKS[0];

      // ---- Build conversation messages ----
      // Sanitize and limit history to last 20 turns (10 user + 10 assistant) to stay within token limits
      const historyMessages: ChatMessage[] = rawHistory
        .filter(
          (m: any) =>
            m &&
            typeof m === 'object' &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string' &&
            m.content.trim().length > 0
        )
        .slice(-20)
        .map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content.trim().slice(0, 1000), // cap each history message
        }));

      const messages: ChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...historyMessages,
        {
          role: 'user',
          content: language && language !== 'en'
            ? `[Language preference: ${language}]\n\n${message}`
            : message,
        },
      ];

      // ---- Call OpenRouter with timeout ----
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 80_000); // 80 second timeout

      let provider: Response | globalThis.Response;
      try {
        provider = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://seerat.app',
            'X-Title': 'SEERAT Islamic Assistant',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens: 1024,
          }),
          signal: controller.signal,
        }) as globalThis.Response;
      } finally {
        clearTimeout(timeoutId);
      }

      // ---- Handle provider HTTP errors ----
      if (!provider.ok) {
        const errorText = await provider.text();
        logger.error(`OpenRouter error (HTTP ${provider.status}) model=${model}: ${errorText.slice(0, 400)}`);

        let userMsg: string;
        let httpStatus: number;

        switch (provider.status) {
          case 429:
            userMsg = 'The Islamic Assistant is busy right now (rate limit reached). Please wait a moment and try again.';
            httpStatus = 429;
            break;
          case 402:
            userMsg = 'The Islamic Assistant service requires configuration. Please contact support.';
            httpStatus = 503;
            break;
          case 503:
          case 504:
            userMsg = 'The Islamic Assistant is temporarily unavailable. Please try again in a few moments.';
            httpStatus = 503;
            break;
          default: {
            let detailMsg = `HTTP ${provider.status}`;
            try {
              const parsed = JSON.parse(errorText);
              if (parsed?.error?.message) detailMsg = parsed.error.message;
            } catch { /* ignore */ }
            userMsg = `The Islamic Assistant encountered an issue: ${detailMsg}`;
            httpStatus = provider.status >= 500 ? 503 : 502;
          }
        }

        ResponseUtil.error(res, 'AI_PROVIDER_ERROR', userMsg, httpStatus);
        return;
      }

      // ---- Parse response ----
      const payload = await provider.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
      };

      if (payload.error?.message) {
        logger.warn(`OpenRouter returned error in body: ${payload.error.message}`);
        ResponseUtil.error(
          res,
          'AI_MODEL_ERROR',
          `The Islamic Assistant could not respond: ${payload.error.message}`,
          502
        );
        return;
      }

      const answer = payload.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        logger.warn(`OpenRouter returned empty choices. Model: ${model}. Payload: ${JSON.stringify(payload).slice(0, 300)}`);
        ResponseUtil.error(
          res,
          'AI_EMPTY_RESPONSE',
          'The Islamic Assistant could not generate a response. Please try again.',
          502
        );
        return;
      }

      logger.info(`AI assistant responded successfully. Model: ${model}, message_len: ${message.length}, history_turns: ${historyMessages.length / 2}`);
      ResponseUtil.success(res, { answer, references: [], language }, 'Assistant response generated.');
    } catch (error: any) {
      if (error?.name === 'AbortError' || error?.message?.includes('aborted')) {
        logger.warn('OpenRouter request timed out after 80 seconds.');
        ResponseUtil.error(
          res,
          'AI_TIMEOUT',
          'The Islamic Assistant took too long to respond. Please try a shorter question or try again.',
          504
        );
        return;
      }
      logger.error('Unexpected error in mobileAi.assistant:', error);
      next(error);
    }
  }
}

export const mobileAiController = new MobileAiController();
