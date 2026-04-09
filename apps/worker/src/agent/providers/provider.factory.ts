import type { AiProvider } from './provider.interface';
import { GeminiProvider } from './gemini.provider';
import { OpenAiProvider } from './openai.provider';
import { AnthropicProvider } from './anthropic.provider';

export interface ProviderConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

// Base URLs for OpenAI-compatible providers
const OPENAI_COMPAT_URLS: Record<string, string> = {
  GROQ: 'https://api.groq.com/openai/v1',
  DEEPSEEK: 'https://api.deepseek.com/v1',
  XAI: 'https://api.x.ai/v1',
  MISTRAL: 'https://api.mistral.ai/v1',
  TOGETHER: 'https://api.together.xyz/v1',
  MOONSHOT: 'https://api.moonshot.ai/v1',
  OPENROUTER: 'https://openrouter.ai/api/v1',
};

export class ProviderFactory {
  static create(config: ProviderConfig): AiProvider {
    switch (config.provider) {
      case 'GEMINI':
        return new GeminiProvider(config.apiKey, config.model);

      case 'OPENAI':
        return new OpenAiProvider(config.apiKey, config.model, 'OPENAI');

      case 'ANTHROPIC':
        return new AnthropicProvider(config.apiKey, config.model);

      case 'OLLAMA':
        return new OpenAiProvider(
          'ollama',
          config.model,
          'OLLAMA',
          config.baseUrl ?? 'http://localhost:11434/v1',
        );

      case 'CUSTOM':
        return new OpenAiProvider(config.apiKey, config.model, 'CUSTOM', config.baseUrl);

      default: {
        // GROQ, DEEPSEEK, XAI, MISTRAL, TOGETHER, MOONSHOT, OPENROUTER
        // All use OpenAI-compatible APIs
        const baseUrl = OPENAI_COMPAT_URLS[config.provider];
        if (!baseUrl) {
          return new OpenAiProvider(config.apiKey, config.model, config.provider, config.baseUrl);
        }
        return new OpenAiProvider(config.apiKey, config.model, config.provider, baseUrl);
      }
    }
  }
}
