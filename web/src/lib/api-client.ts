const jsonLike = (value: string) => {
  const trimmed = value.trimStart()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

const payloadError = (payload: unknown) => {
  if (!payload || typeof payload !== 'object') {
    return undefined
  }
  const error = (payload as { error?: unknown }).error
  return typeof error === 'string' && error ? error : undefined
}

const nonJSONMessage = (response: Response) => {
  if (response.url.includes('/api/')) {
    return 'QR 処理 API に接続できませんでした。サーバー設定を確認してから、もう一度お試しください。'
  }
  return `通信に失敗しました (${response.status})`
}

export const readJSONResponse = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type') ?? ''
  const text = await response.text()

  if (!contentType.toLowerCase().includes('application/json') && !jsonLike(text)) {
    throw new Error(nonJSONMessage(response))
  }

  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error('サーバーから不正な JSON が返されました。もう一度お試しください。')
  }

  if (!response.ok) {
    throw new Error(payloadError(payload) ?? `通信に失敗しました (${response.status})`)
  }

  return payload as T
}
