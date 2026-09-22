import type { Config, ReferenceImage } from './hooks/useTauriCommands';

export function stripCodeFences(text: string): string {
  const trimmed = text.trim().replace(/^\uFEFF/, '');
  const match = trimmed.match(/```(?:openscad|scad)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : trimmed;
}

export function clampPreviewFn(code: string): string {
  return code
    .split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('$fn') && trimmed.includes('=') && trimmed.endsWith(';')) {
        const parts = trimmed.split('=');
        if (parts.length === 2) {
          const numStr = parts[1].replace(';', '').trim();
          const num = parseInt(numStr, 10);
          if (!isNaN(num) && num > 128) {
            return `$fn = 64; // [Preview guard: original $fn=${num} was limited]`;
          }
        }
      }
      return line;
    })
    .join('\n');
}

export function buildSystemPrompt(prompt: string, existingCode: string, skills?: string[]): string {
  const skillsText = skills && skills.length > 0
    ? `\nActive User Design Rules & Skills to strictly follow:\n${skills.join('\n')}\n`
    : '';

  return (
    'You are an OpenSCAD engineer. Return ONLY runnable OpenSCAD code, no markdown. ' +
    'Use top-level numeric parameters and printable geometry. Keep $fn between 24 and 64 for preview performance. ' +
    'Do not import external files.\n' +
    'CRITICAL LANGUAGE RULE:\n' +
    'All code comments (// and /* */), parameter annotations, and inline notes in the generated OpenSCAD code MUST be written in the EXACT SAME LANGUAGE as the user request prompt below.\n' +
    '- If the user request is in English, all comments and parameter descriptions must be in English.\n' +
    '- If the user request is in Turkish, all comments and parameter descriptions must be in Turkish.\n' +
    '- If the user request is in any other language, all comments must be in that language.\n' +
    '- Never output comments in a different language from the user prompt. Even if existing code contains comments in another language, translate and adapt all comments in your generated code to match the language of the user prompt.\n' +
    `Request: ${prompt}\n` +
    skillsText +
    (existingCode.trim()
      ? `Existing code to modify if relevant (translate comments to match the prompt language):\n${existingCode}\n`
      : '')
  );
}

export async function generateInBrowser(
  config: Config,
  prompt: string,
  existingCode: string,
  image?: ReferenceImage,
  skills?: string[],
  repairError?: string
): Promise<string> {
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    const key = config.gemini_key?.trim();
    if (!key) {
      throw new Error(
        'Gemini API key is required. Click "Add Key" or Settings to enter your key. (Get a free key at https://aistudio.google.com/app/apikey)'
      );
    }

    const model = config.model?.trim() || 'gemini-2.5-flash';
    const basePrompt = buildSystemPrompt(prompt, existingCode, skills);
    const fullPrompt = repairError
      ? `${basePrompt}\nRepair this failed code:\n${existingCode}\nCompiler error:\n${repairError}\nReminder: Ensure all comments and annotations remain in the exact same language as the user request prompt.`
      : basePrompt;

    const parts: Array<Record<string, unknown>> = [{ text: fullPrompt }];
    if (image) {
      parts.push({
        inline_data: {
          mime_type: image.mime,
          data: image.data,
        },
      });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
    });

    if (!response.ok) {
      let errMsg = `Gemini API error (HTTP ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errMsg = `Gemini API error: ${errorData.error.message}`;
        }
      } catch {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error('Gemini returned an empty response.');

    const candidateParts = candidate.content?.parts;
    if (Array.isArray(candidateParts)) {
      const texts = candidateParts
        .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === 'string')
        .map((p: { text: string }) => p.text);
      if (texts.length > 0) {
        return clampPreviewFn(stripCodeFences(texts.join('\n')));
      }
    }
    throw new Error('Gemini did not return any code.');
  }

  if (provider === 'openai') {
    const key = config.openai_key?.trim();
    if (!key) {
      throw new Error(
        'OpenAI API key is required. Click "Add Key" or Settings to enter your key. (Get a key at https://platform.openai.com/api-keys)'
      );
    }

    const model = config.model?.trim() || 'gpt-4o';
    const basePrompt = buildSystemPrompt(prompt, existingCode, skills);
    const fullPrompt = repairError
      ? `${basePrompt}\nRepair this failed code:\n${existingCode}\nCompiler error:\n${repairError}\nReminder: Ensure all comments and annotations remain in the exact same language as the user request prompt.`
      : basePrompt;

    const content: Array<Record<string, unknown>> = [{ type: 'text', text: fullPrompt }];
    if (image) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.data}` },
      });
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!response.ok) {
      let errMsg = `OpenAI API error (HTTP ${response.status})`;
      try {
        const errorData = await response.json();
        if (errorData.error?.message) {
          errMsg = `OpenAI API error: ${errorData.error.message}`;
        }
      } catch {}
      throw new Error(errMsg);
    }

    const data = await response.json();
    const messageContent = data.choices?.[0]?.message?.content;
    if (!messageContent) throw new Error('OpenAI returned an empty response.');
    return clampPreviewFn(stripCodeFences(messageContent));
  }

  throw new Error(`Provider "${provider}" is not supported in the browser. Please choose Gemini or OpenAI.`);
}

export async function analyzeImageInBrowser(config: Config, image: ReferenceImage): Promise<string> {
  const prompt =
    'Describe this object as a precise CAD design brief for OpenSCAD. ' +
    'Describe shapes, relative dimensions, and suggested parameters. ' +
    'Clearly label dimensions inferred from the image as estimates. Return a design brief, not code.';

  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    const key = config.gemini_key?.trim();
    if (!key) throw new Error('Gemini API key is required to analyze images.');
    const model = config.model?.trim() || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: image.mime, data: image.data } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Gemini API error (HTTP ${response.status})`);
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('');
    if (!text) throw new Error('No analysis generated.');
    return text.trim();
  }

  if (provider === 'openai') {
    const key = config.openai_key?.trim();
    if (!key) throw new Error('OpenAI API key is required to analyze images.');
    const model = config.model?.trim() || 'gpt-4o';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.data}` } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI API error (HTTP ${response.status})`);
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('No analysis generated.');
    return text.trim();
  }

  throw new Error('Image analysis requires Gemini or OpenAI.');
}

export async function fetchBrowserModels(config: Config): Promise<string[]> {
  const provider = config.provider || 'gemini';

  if (provider === 'gemini') {
    const key = config.gemini_key?.trim();
    if (!key) throw new Error('Add your Gemini API key in Settings first.');
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not fetch models (HTTP ${res.status})`);
    const data = await res.json();
    const models: string[] = (data.models || [])
      .map((m: { name: string }) => m.name.replace('models/', ''))
      .filter((name: string) => name.includes('flash') || name.includes('pro') || name.includes('gemini'));
    return models.length > 0 ? models : ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
  }

  if (provider === 'openai') {
    const key = config.openai_key?.trim();
    if (!key) throw new Error('Add your OpenAI API key in Settings first.');
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Could not fetch models (HTTP ${res.status})`);
    const data = await res.json();
    const models: string[] = (data.data || [])
      .map((m: { id: string }) => m.id)
      .filter((id: string) => id.includes('gpt') || id.includes('o1') || id.includes('o3'));
    return models.length > 0 ? models : ['gpt-4o', 'gpt-4o-mini', 'o3-mini'];
  }

  return [];
}
