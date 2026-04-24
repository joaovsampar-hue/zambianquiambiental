import { supabase } from "@/integrations/supabase/client";
import { SYSTEM_PROMPT, NEIGHBOR_SYSTEM_PROMPT } from "./ai-prompts";

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

export interface GeminiResponse {
  extracted_data?: any;
  alerts?: any[];
  error?: string;
}

const tryParseJson = (raw: string) => {
  try {
    const m = raw.match(/```json\s*([\s\S]*?)\s*```/) || raw.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? (m[1] || m[0]) : raw);
  } catch {
    return null;
  }
};

const convertBlobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

export const analyzeWithGeminiDirectly = async (
  type: 'principal' | 'neighbor',
  imagePaths: string[] | string, // Pode ser array de caminhos (principal) ou um único caminho (neighbor)
  analysisId?: string
): Promise<GeminiResponse> => {
  if (!GOOGLE_API_KEY) {
    throw new Error("VITE_GOOGLE_API_KEY não configurada no arquivo .env");
  }

  const prompt = type === 'principal' ? SYSTEM_PROMPT : NEIGHBOR_SYSTEM_PROMPT;
  const modelFlash = "gemini-1.5-flash";
  const modelPro = "gemini-1.5-pro";

  const paths = Array.isArray(imagePaths) ? imagePaths : [imagePaths];
  const parts: any[] = [];

  // Download e conversão para Base64
  for (const path of paths) {
    const { data: blob, error: dErr } = await supabase.storage.from("matriculas").download(path);
    if (dErr) throw dErr;
    
    const base64 = await convertBlobToBase64(blob);
    const mimeType = path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg';
    parts.push({ inlineData: { mimeType, data: base64 } });
  }

  const callGemini = async (model: string, userText: string) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GOOGLE_API_KEY}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: userText }, ...parts] }],
        systemInstruction: { parts: [{ text: prompt }] },
        generationConfig: { temperature: 0, responseMimeType: "application/json" }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  };

  try {
    let content = await callGemini(modelFlash, "Analise este documento de imóvel rural. Extraia os dados no formato JSON especificado.");
    let parsed = tryParseJson(content);

    // Retry com Pro se falhar ou vier vazio
    if (!parsed || (type === 'principal' && (!parsed.owners || parsed.owners.length === 0))) {
      console.log("Retry with Gemini Pro...");
      content = await callGemini(modelPro, "A análise anterior falhou. Tente novamente com atenção máxima.");
      parsed = tryParseJson(content);
    }

    if (!parsed) throw new Error("Não foi possível processar a resposta da IA como JSON.");

    return { extracted_data: parsed, alerts: parsed.alerts ?? [] };
  } catch (error: any) {
    console.error("Gemini Direct Analysis Error:", error);
    return { error: error.message };
  }
};
