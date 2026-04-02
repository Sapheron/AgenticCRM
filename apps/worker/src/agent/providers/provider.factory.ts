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

export const PROVIDER_MODELS: Record<string, string[]> = {
  GEMINI: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  OPENAI: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  ANTHROPIC: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  GROQ: ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma-7b-it'],
  OLLAMA: ['llama3', 'mistral', 'phi3', 'gemma2'],
  OPENROUTER: ['openai/gpt-4o', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5', 'meta-llama/llama-3-70b'],
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

      case 'GROQ':
        return new OpenAiProvider(
          config.apiKey,
          config.model,
          'GROQ',
          'https://api.groq.com/openai/v1',
        );

      case 'OLLAMA':
        return new OpenAiProvider(
          'ollama', // Ollama doesn't need a real key
          config.model,
          'OLLAMA',
          config.baseUrl ?? 'http://localhost:11434/v1',
        );

      case 'OPENROUTER':
        return new OpenAiProvider(
          config.apiKey,
          config.model,
          'OPENROUTER',
          'https://openrouter.ai/api/v1',
        );

      default:
        // CUSTOM: openai-compatible with custom base URL
        return new OpenAiProvider(config.apiKey, config.model, 'CUSTOM', config.baseUrl);
    }
  }
}
