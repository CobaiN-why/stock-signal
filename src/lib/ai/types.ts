export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiProvider {
  name: string;
  defaultModel: string;
  chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
}
