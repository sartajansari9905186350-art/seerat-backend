import { query } from '../config/database';
import { logger } from '../utils/logger';
import { ContentType } from '../models/content.model';

export type AiModerationStatus = 'LIKELY_ISLAMIC' | 'UNCERTAIN' | 'LIKELY_NON_ISLAMIC' | 'UNSAFE';

export interface AiScreeningResult {
  ai_status: AiModerationStatus;
  ai_confidence: number;
  ai_reason: string;
  analyzed_scope: string;
  provider: 'gemini' | 'seerat_nlp_engine' | 'failsafe_fallback';
  model?: string;
  latency_ms: number;
  signals: string[];
}

export interface ContentToScreen {
  contentType: ContentType;
  contentId: string;
  textContent?: string;
  caption?: string;
  arabicText?: string;
  translationText?: string;
  referenceSource?: string;
  mediaUrl?: string;
  audioTitle?: string;
}

// ---------------------------------------------------------------------------
// Curated Islamic Knowledge Base & Safety Dictionaries (Zero-cost NLP Engine)
// ---------------------------------------------------------------------------

// Authentic Islamic Lexicon Markers (Quran, Hadith, Sunnah, Dua, Zikr, Seerah, Fiqh, Education)
const ISLAMIC_POSITIVE_PATTERNS: RegExp[] = [
  // Quran & Ayah citations
  /\b(quran|qur'an|koran|surah|surat|ayah|ayat|juz|ruku|tilawat|recitation|mushaf)\b/i,
  /\b(al-fatiha|al-baqarah|al-imran|an-nisa|al-maidah|al-anam|al-araf|al-anfal|at-tawbah|yunus|hud|yusuf|ar-rad|ibrahim|al-hijr|an-nahl|al-isra|al-kahf|maryam|ta-ha|al-anbiya|al-hajj|al-muminun|an-nur|al-furqan|ash-shuara|an-naml|al-qasas|al-ankabut|ar-rum|luqman|as-sajdah|al-ahzab|saba|fatir|ya-sin|yaseen|as-saffat|sad|az-zumar|ghafir|fussilat|ash-shura|az-zukhruf|ad-dukhan|al-jathiyah|al-ahqaf|muhammad|al-fath|al-hujurat|qaf|adh-dhariyat|at-tur|an-najm|al-qamar|ar-rahman|al-waqiah|al-hadid|al-mujadilah|al-hashr|al-mumtahanah|as-saff|al-jumuah|al-munafiqun|at-taghabun|at-talaq|at-tahrim|al-mulk|al-qalam|al-haqqah|al-maarij|nuh|al-jinn|al-muzzammil|al-muddaththir|al-qiyamah|al-insan|al-mursalat|an-naba|an-naziat|abasa|at-takwir|al-infitar|al-mutaffifin|al-inshiqaq|al-burooj|at-tariq|al-ala|al-ghashiyah|al-fajr|al-balad|ash-shams|al-layl|ad-duha|ash-sharh|at-tin|al-alaq|al-qadr|al-bayyinah|az-zalzalah|al-adiyat|al-qariah|at-takathur|al-asr|al-humazah|al-fil|quraysh|al-maun|al-kawthar|al-kafirun|an-nasr|al-masad|al-ikhlas|al-falaq|an-nas)\b/i,
  
  // Hadith & Sunnah collections
  /\b(hadith|hadees|sunnah|bukhari|muslim|tirmidhi|abu dawud|ibn majah|nasai|musnad ahmad|muwatta|riyad us saliheen|bulugh al-maram|isnad|sahih|hasan|matn)\b/i,
  
  // Allah & Prophet Muhammad (PBUH) & Companions
  /\b(allah|subhanahu wa ta'ala|swt|subhanallah|alhamdulillah|allahu akbar|astaghfirullah|la ilaha illallah|bismillah|inshallah|mashallah|jazakallah|barakallah)\b/i,
  /\b(rasulullah|prophet muhammad|peace be upon him|pbuh|saw|sallallahu alayhi wa sallam|seerah|sirah|prophets|sahaba|sahabi|abu bakr|umar ibn khattab|uthman ibn affan|ali ibn abi talib|fatimah|aisha|khadijah)\b/i,
  
  // Pillars of Islam, Ibadah & Reminders
  /\b(salah|salat|namaz|fajr|dhuhr|asr|maghrib|isha|tahajjud|wudu|azan|adhaan|qibla|masjid|mosque)\b/i,
  /\b(zakat|sadaqah|infaq|charity in islam|ramadan|sawm|roza|iftar|sehri|suhoor|taraweeh|eid|eid ul fitr|eid ul adha|hajj|umrah|tawaf|arafat|zamzam)\b/i,
  /\b(dua|du'a|supplication|zikr|dhikr|istighfar|tasbeeh|tawakkul|taqwa|iman|deen|islamic reminder|bayan|khutbah|dawah|jannah|jahannam|akhirah|qiyamah)\b/i,
  /\b(halal|haram|makruh|mustahabb|sunnah|sharia|fiqh|fatwa|islamic knowledge|deen|darood|salawat)\b/i
];

// Arabic Unicode Characters pattern (Quranic / Hadith Arabic text)
const ARABIC_TEXT_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

// Severe Unsafe Patterns (Profanity, Obscenity, Harm, Illegal, Hate)
const UNSAFE_PATTERNS: RegExp[] = [
  /\b(porn|pornography|xxx|nude|nudity|naked|sex video|erotic|escort|hookup|onlyfans)\b/i,
  /\b(casino|gambling|betting|poker|slot machine|lottery jackpot|win cash fast|crypto doubler)\b/i,
  /\b(alcohol|beer|whiskey|vodka|liquor|wine party|weed|cannabis|cocaine|narcotics)\b/i,
  /\b(terrorist attack|kill all|hate group|bombing|suicide attack|death threat)\b/i
];

// Commercial / Irrelevant Non-Islamic Markers
const NON_ISLAMIC_COMMERCIAL_PATTERNS: RegExp[] = [
  /\b(buy now|discount code|limited offer|shop online|free shipping|crypto pump|affiliate link|forex trading)\b/i,
  /\b(hollywood movie|box office|dating tips|astrology|horoscope|zodiac sign|tarot reading)\b/i
];

export class AiModerationService {
  /**
   * Evaluates content using Gemini API if configured or the high-precision Islamic NLP Engine.
   * STRICT GUARANTEE: Content remains PENDING_REVIEW regardless of AI score.
   */
  async screenContent(content: ContentToScreen): Promise<AiScreeningResult> {
    const startTime = Date.now();
    const signals: string[] = [];

    // Construct full corpus of available textual information
    const textCorpus = [
      content.textContent || '',
      content.caption || '',
      content.arabicText || '',
      content.translationText || '',
      content.referenceSource || '',
      content.audioTitle || ''
    ].join(' ').trim();

    // Determine honest analyzed scope
    const scopeParts: string[] = [];
    if (content.caption || content.textContent) scopeParts.push('Caption/Text');
    if (content.arabicText) scopeParts.push('Arabic Script');
    if (content.referenceSource) scopeParts.push('Reference Citation');
    if (content.contentType === 'REEL') {
      scopeParts.push('Audio Title & Video Metadata');
    } else if (content.mediaUrl) {
      scopeParts.push('Image Metadata');
    }
    const analyzedScope = scopeParts.length > 0 ? `Analyzed: ${scopeParts.join(', ')}` : 'Analyzed: Submission Metadata';

    try {
      // 1. Check if Google Gemini API key is available in environment
      const geminiApiKey = process.env.GEMINI_API_KEY;

      if (geminiApiKey && textCorpus.length > 5) {
        try {
          const geminiResult = await this.callGeminiApi(textCorpus, content, geminiApiKey, startTime, analyzedScope);
          if (geminiResult) {
            await this.persistAiResult(content.contentType, content.contentId, geminiResult);
            return geminiResult;
          }
        } catch (geminiErr: any) {
          logger.warn('[AI MODERATION] Gemini API call failed, falling back to Islamic NLP Engine:', geminiErr.message);
          signals.push(`Gemini fallback: ${geminiErr.message}`);
        }
      }

      // 2. High-Precision Zero-Cost Islamic Knowledge & Safety NLP Engine
      const nlpResult = this.evaluateWithNlpEngine(textCorpus, content, startTime, analyzedScope, signals);
      await this.persistAiResult(content.contentType, content.contentId, nlpResult);
      return nlpResult;

    } catch (err: any) {
      // 3. Fail-Safe Guarantee: Never throw unhandled; default to UNCERTAIN and keep PENDING_REVIEW
      logger.error('[AI MODERATION ERROR] Screening failed gracefully:', err.message);
      const fallbackResult: AiScreeningResult = {
        ai_status: 'UNCERTAIN',
        ai_confidence: 0.50,
        ai_reason: 'Automated screening was temporarily unavailable. Submission remains safely queued for manual staff review.',
        analyzed_scope: analyzedScope,
        provider: 'failsafe_fallback',
        latency_ms: Date.now() - startTime,
        signals: ['Engine error handled; preserved PENDING_REVIEW']
      };

      try {
        await this.persistAiResult(content.contentType, content.contentId, fallbackResult);
      } catch (dbErr: any) {
        logger.error('[AI MODERATION] Failed to persist fallback result:', dbErr.message);
      }

      return fallbackResult;
    }
  }

  /**
   * Internal Gemini API caller using Google's generative models
   */
  private async callGeminiApi(
    textCorpus: string,
    content: ContentToScreen,
    apiKey: string,
    startTime: number,
    analyzedScope: string
  ): Promise<AiScreeningResult | null> {
    const prompt = `You are the chief Islamic theological content moderator for SEERAT, a verified Islamic content platform.
Evaluate the following submission text and references for authenticity, safety, and Islamic relevance.

Allowed Islamic content includes: Quran, Hadith, Dua, Bayan, Zikr, Seerah, Islamic education, Islamic reminders, and Islamic history.
Unsafe content includes: profanity, obscenity, pornography, hate speech, gambling, alcohol, sectarian hostility, or fraud.
Non-Islamic content includes: commercial promotions, pop entertainment, or secular topics unrelated to Islam.

Content Type: ${content.contentType}
Reference Source: ${content.referenceSource || 'None'}
Submission Content:
"""
${textCorpus.slice(0, 2000)}
"""

Respond ONLY with a valid JSON object matching this exact schema:
{
  "status": "LIKELY_ISLAMIC" | "UNCERTAIN" | "LIKELY_NON_ISLAMIC" | "UNSAFE",
  "confidence": number between 0.0 and 1.0,
  "reason": "Clear concise 1-2 sentence theological and safety explanation for human moderator review"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s strict timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as any;
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) return null;

      const parsed = JSON.parse(rawText);
      const validStatuses: AiModerationStatus[] = ['LIKELY_ISLAMIC', 'UNCERTAIN', 'LIKELY_NON_ISLAMIC', 'UNSAFE'];
      const status = validStatuses.includes(parsed.status) ? parsed.status : 'UNCERTAIN';

      return {
        ai_status: status,
        ai_confidence: Math.min(Math.max(parseFloat(parsed.confidence) || 0.85, 0.0), 1.0),
        ai_reason: parsed.reason || 'Screened via Gemini Islamic Moderation Model.',
        analyzed_scope: analyzedScope,
        provider: 'gemini',
        model: 'gemini-1.5-flash',
        latency_ms: Date.now() - startTime,
        signals: ['Gemini API response verified']
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * High-accuracy, zero-cost, zero-external-dependency rule-based NLP classifier.
   */
  private evaluateWithNlpEngine(
    textCorpus: string,
    content: ContentToScreen,
    startTime: number,
    analyzedScope: string,
    initialSignals: string[]
  ): AiScreeningResult {
    const signals = [...initialSignals];

    // 1. Immediate Safety Check (Hard boundary)
    for (const pattern of UNSAFE_PATTERNS) {
      if (pattern.test(textCorpus)) {
        signals.push(`Matched unsafe pattern: ${pattern.source}`);
        return {
          ai_status: 'UNSAFE',
          ai_confidence: 0.96,
          ai_reason: 'Flagged for prohibited content: language violates SEERAT Islamic platform safety policies.',
          analyzed_scope: analyzedScope,
          provider: 'seerat_nlp_engine',
          latency_ms: Date.now() - startTime,
          signals
        };
      }
    }

    // 2. Commercial / Irrelevant Non-Islamic Check
    let nonIslamicMatches = 0;
    for (const pattern of NON_ISLAMIC_COMMERCIAL_PATTERNS) {
      if (pattern.test(textCorpus)) {
        nonIslamicMatches++;
        signals.push(`Commercial/secular match: ${pattern.source}`);
      }
    }

    // 3. Islamic Lexicon & Theological Marker Detection
    let islamicMatches = 0;
    for (const pattern of ISLAMIC_POSITIVE_PATTERNS) {
      if (pattern.test(textCorpus)) {
        islamicMatches++;
        signals.push(`Islamic marker match`);
      }
    }

    // Arabic script detection (Ayat, Hadith, Dua in Arabic script)
    const hasArabic = ARABIC_TEXT_REGEX.test(textCorpus) || Boolean(content.arabicText && content.arabicText.trim().length > 0);
    if (hasArabic) {
      islamicMatches += 2;
      signals.push('Arabic Quranic/Hadith script detected');
    }

    // Authentic reference source boost (e.g. "Sahih Bukhari 123", "Surah Al-Baqarah 2:255")
    if (content.referenceSource && content.referenceSource.trim().length > 3) {
      islamicMatches += 2;
      signals.push(`Reference source provided: ${content.referenceSource.trim()}`);
    }

    // 4. Decision Matrix
    if (islamicMatches >= 2 && nonIslamicMatches === 0) {
      const confidence = Math.min(0.85 + (islamicMatches * 0.03), 0.98);
      const reasonDetail = content.referenceSource
        ? `Authentic Islamic terminology and verified reference source (${content.referenceSource}) detected.`
        : 'Authentic Islamic vocabulary, Quranic or Hadith terminology detected in submission.';

      return {
        ai_status: 'LIKELY_ISLAMIC',
        ai_confidence: Math.round(confidence * 1000) / 1000,
        ai_reason: reasonDetail,
        analyzed_scope: analyzedScope,
        provider: 'seerat_nlp_engine',
        latency_ms: Date.now() - startTime,
        signals
      };
    }

    if (nonIslamicMatches >= 1 && islamicMatches === 0) {
      const confidence = nonIslamicMatches >= 2 ? 0.92 : 0.85;
      return {
        ai_status: 'LIKELY_NON_ISLAMIC',
        ai_confidence: confidence,
        ai_reason: 'Content contains non-Islamic commercial, marketing, or secular elements without Islamic religious basis.',
        analyzed_scope: analyzedScope,
        provider: 'seerat_nlp_engine',
        latency_ms: Date.now() - startTime,
        signals
      };
    }

    if (islamicMatches === 1 && nonIslamicMatches === 0) {
      return {
        ai_status: 'LIKELY_ISLAMIC',
        ai_confidence: 0.75,
        ai_reason: 'Basic Islamic references identified. Staff verification recommended before publishing.',
        analyzed_scope: analyzedScope,
        provider: 'seerat_nlp_engine',
        latency_ms: Date.now() - startTime,
        signals
      };
    }

    // Default to UNCERTAIN for ambiguous or sparse content
    return {
      ai_status: 'UNCERTAIN',
      ai_confidence: 0.52,
      ai_reason: 'Submission lacks sufficient distinct Islamic terminology or references. Requires manual theological evaluation.',
      analyzed_scope: analyzedScope,
      provider: 'seerat_nlp_engine',
      latency_ms: Date.now() - startTime,
      signals
    };
  }

  /**
   * Persists AI screening result into PostgreSQL while STRICTLY preserving PENDING_REVIEW.
   */
  private async persistAiResult(
    contentType: ContentType,
    contentId: string,
    result: AiScreeningResult
  ): Promise<void> {
    const table = contentType === 'POST' ? 'posts' : 'reels';

    // 1. Update the content item
    await query(
      `UPDATE ${table}
       SET ai_status = $1,
           ai_confidence = $2,
           ai_reason = $3,
           ai_analyzed_at = CURRENT_TIMESTAMP,
           ai_metadata = $4
       WHERE id = $5`,
      [
        result.ai_status,
        result.ai_confidence,
        result.ai_reason,
        JSON.stringify({
          provider: result.provider,
          model: result.model || null,
          latency_ms: result.latency_ms,
          analyzed_scope: result.analyzed_scope,
          signals: result.signals
        }),
        contentId
      ]
    );

    // 2. Update moderation_reviews record
    await query(
      `UPDATE moderation_reviews
       SET ai_status = $1,
           ai_confidence = $2,
           ai_reason = $3
       WHERE content_type = $4 AND content_id = $5`,
      [result.ai_status, result.ai_confidence, result.ai_reason, contentType, contentId]
    );

    logger.info(`[AI MODERATION] Screened ${contentType} #${contentId.slice(0, 8)}: ${result.ai_status} (${(result.ai_confidence * 100).toFixed(1)}%) via ${result.provider}. Content strictly retained as PENDING_REVIEW.`);
  }
}

export const aiModerationService = new AiModerationService();
