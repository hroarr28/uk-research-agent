import type { CompletionRequest, CompletionResponse, ModelProvider } from "./types.js";

export class ModelProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelProviderError";
    this.code = code;
  }
}

export class ScriptedModel implements ModelProvider {
  readonly id = "scripted";
  readonly requests: CompletionRequest[] = [];
  private index = 0;

  constructor(private readonly responses: readonly CompletionResponse[]) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.requests.push(request);
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) {
      throw new ModelProviderError(
        "script_exhausted",
        `No scripted response for step ${this.index}.`,
      );
    }
    return response;
  }
}
