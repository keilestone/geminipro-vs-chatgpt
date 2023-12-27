export interface ChatPart {
  text: string
}

export interface ChatMessage {
  role: 'model' | 'user' | 'assistant'
  parts?: ChatPart[]
  content?: string
}

export interface ErrorMessage {
  code: string
  message: string
}
